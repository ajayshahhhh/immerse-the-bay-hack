import {
  Camera,
  Observer,
  Scene,
  Vector3,
  UniversalCamera,
  MeshBuilder,
  Mesh,
  StandardMaterial,
  Color3,
  Quaternion
} from "@babylonjs/core";
import { z } from "zod";

import { BaseBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";

export class FlyoverCamera extends BaseBehavior<Camera> {
  public name = "FlyoverCamera";
  public static argsSchema = z.object({
    duration: z.number().positive().describe("Duration of the flyover animation in seconds"),
    autoStart: z.boolean().describe("Whether to automatically start the flyover animation when the behavior starts"),
    loop: z.boolean().describe("Whether to loop the flyover animation continuously")
  }).describe(JSON.stringify({
    summary: "Creates a cinematic flyover camera that smoothly moves along a predefined path while looking at target points. Perfect for establishing shots, scene introductions, or cinematic sequences.",
    whenToAttach: "Attach to camera entities for cinematic flyover sequences. Typically used for intro sequences or establishing shots.",
    requirementsToAttach: "Must be attached to a Camera entity. The flyover path and look-at targets are hardcoded for proof of concept.",
    howToEdit: "Edit the file directly. The path consists of 8 predefined points creating a cinematic sweep around the scene center."
  } satisfies BehaviorMetadata));

  private beforeRenderObserver: Observer<Scene> | null = null;

  // Animation state
  private isAnimating: boolean = false;
  private startTime: number = 0;
  private duration: number;
  private autoStart: boolean;
  private loop: boolean;
  private animationPhase: 'start_pause' | 'moving' | 'end_pause' = 'start_pause';
  private phaseStartTime: number = 0;
  private readonly startPauseDuration: number = 5;
  private readonly endPauseDuration: number = 5;

  // Semicircle path points
  private pathPoints: Vector3[] = [];
  private readonly pitchAngle: number = -Math.PI / 9; // 20 degrees downward

  // Debug sphere
  private debugSphere: Mesh | null = null;

  constructor(args: unknown) {
    super();
    const validatedArgs = FlyoverCamera.argsSchema.parse(args);
    this.duration = validatedArgs.duration;
    this.autoStart = validatedArgs.autoStart;
    this.loop = validatedArgs.loop;
  }

  protected onAwake(): void {
    console.log("FlyoverCamera onAwake called");
    console.log("Node:", this.node.name);

    // Generate semicircle path from 3 points
    this.generateSemicirclePath();

    // Create debug sphere
    this.debugSphere = MeshBuilder.CreateSphere("debugSphere", {
      diameter: 10
    }, this.scene);

    const material = new StandardMaterial("sphereMat", this.scene);
    material.diffuseColor = Color3.Red();
    material.emissiveColor = Color3.Red();
    this.debugSphere.material = material;
    this.debugSphere.renderingGroupId = 3;
  }

  private generateSemicirclePath(): void {
    // Three points defining the semicircle
    const p1 = new Vector3(-21.2, 22, -21.2);   // Start
    const p2 = new Vector3(-30, 22, 0);   // Start
    const p3 = new Vector3(-10, 22, 28.3);  // Middle
    // const p3 = new Vector3(20, 25, 22.3);    // End

    // Find circle center and radius from 3 points
    // Since all points have same Y, we work in XZ plane
    const center = this.findCircleCenter(p1, p2, p3);
    const radius = Vector3.Distance(center, p1);

    // Calculate angles for start and end points
    const startAngle = Math.atan2(p1.z - center.z, p1.x - center.x);
    let endAngle = Math.atan2(p3.z - center.z, p3.x - center.x);

    // Always take the shortest arc - adjust endAngle to be within ±π of startAngle
    const angleDiff = endAngle - startAngle;

    if (angleDiff > Math.PI) {
      endAngle -= 2 * Math.PI;
    } else if (angleDiff < -Math.PI) {
      endAngle += 2 * Math.PI;
    }

    console.log("Angles - start:", startAngle, "end:", endAngle);
    console.log("Total arc angle:", endAngle - startAngle, "radians =", (endAngle - startAngle) * 180 / Math.PI, "degrees");

    // Generate points along the arc
    const numPoints = 500; // 500 is plenty for smooth motion
    this.pathPoints = [];

    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const angle = startAngle + t * (endAngle - startAngle);

      const x = center.x + radius * Math.cos(angle);
      const z = center.z + radius * Math.sin(angle);
      const y = p1.y; // Constant height

      this.pathPoints.push(new Vector3(x, y, z));
    }

    console.log("Generated semicircle path with", this.pathPoints.length, "points");
    console.log("Circle center:", center, "radius:", radius);
  }

  private findCircleCenter(p1: Vector3, p2: Vector3, p3: Vector3): Vector3 {
    // Using the perpendicular bisector method in XZ plane
    const mid1x = (p1.x + p2.x) / 2;
    const mid1z = (p1.z + p2.z) / 2;
    const mid2x = (p2.x + p3.x) / 2;
    const mid2z = (p2.z + p3.z) / 2;

    const dx1 = p2.x - p1.x;
    const dz1 = p2.z - p1.z;
    const dx2 = p3.x - p2.x;
    const dz2 = p3.z - p2.z;

    // Perpendicular slopes
    const slope1 = -dx1 / dz1;
    const slope2 = -dx2 / dz2;

    // Find intersection of perpendicular bisectors
    const centerX = (slope1 * mid1x - slope2 * mid2x + mid2z - mid1z) / (slope1 - slope2);
    const centerZ = slope1 * (centerX - mid1x) + mid1z;

    return new Vector3(centerX, p1.y, centerZ);
  }

  protected onStart(): void {
    console.log("FlyoverCamera onStart called, autoStart:", this.autoStart);
    console.log("Camera node:", this.node.name);

    if (this.autoStart) {
      this.startFlyover();
    }

    // Set up render loop for smooth animation
    this.beforeRenderObserver = this.scene.onBeforeRenderObservable.add(() => {
      if (this.isAnimating) {
        this.updateCameraPosition();
      }
    });
    console.log("Render observer set up");
  }

  protected onDetach(): void {
    if (this.beforeRenderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.beforeRenderObserver);
      this.beforeRenderObserver = null;
    }

    // Clean up debug sphere
    if (this.debugSphere) {
      this.debugSphere.dispose();
      this.debugSphere = null;
    }
  }

  public startFlyover(): void {
    console.log("startFlyover called, isAnimating:", this.isAnimating);
    if (this.isAnimating) {
      this.stopFlyover();
    }

    // Make sure this camera is active
    this.scene.activeCamera = this.node as Camera;
    console.log("Active camera set to:", this.scene.activeCamera.name);

    // Initialize animation
    this.isAnimating = true;
    this.animationPhase = 'start_pause';
    this.phaseStartTime = performance.now();
    this.startTime = performance.now();

    // Set initial position
    if (this.pathPoints.length > 0) {
      this.node.position.copyFrom(this.pathPoints[0]);

      // Set initial camera rotation using quaternion
      const tangent = this.pathPoints[1].subtract(this.pathPoints[0]).normalize();
      const yaw = Math.atan2(-tangent.x, -tangent.z);
      const camera = this.node as UniversalCamera;

      // Use quaternion for consistency with animation
      camera.rotationQuaternion = Quaternion.RotationYawPitchRoll(yaw, this.pitchAngle, 0);

      // Disable inertia to prevent interference
      camera.inertia = 0;

      // Update debug sphere
      if (this.debugSphere) {
        this.debugSphere.position.copyFrom(this.node.position);
      }

      console.log("Start position:", this.node.position);
      console.log("Start tangent:", tangent, "yaw:", yaw);
    }

    console.log("Starting flyover camera animation with start pause, duration:", this.duration);
  }

  public stopFlyover(): void {
    this.isAnimating = false;
    console.log("Stopped flyover camera animation");
  }

  private updateCameraPosition(): void {
    const currentTime = performance.now();
    const phaseElapsed = (currentTime - this.phaseStartTime) / 1000;

    // Handle different animation phases
    switch (this.animationPhase) {
    case 'start_pause':
      if (phaseElapsed >= this.startPauseDuration) {
        // Start pause complete, begin movement
        console.log("Start pause complete, beginning movement");
        this.animationPhase = 'moving';
        this.phaseStartTime = currentTime;
      }
      // Stay at start position during pause
      return;

    case 'moving': {
      const t = phaseElapsed / this.duration;

      if (t >= 1.0) {
        // Movement complete, move to end position and start end pause
        console.log("Movement complete, starting end pause");
        this.animationPhase = 'end_pause';
        this.phaseStartTime = currentTime;

        // Set to final position
        this.node.position.copyFrom(this.pathPoints[this.pathPoints.length - 1]);
        const lastTangent = this.pathPoints[this.pathPoints.length - 1]
          .subtract(this.pathPoints[this.pathPoints.length - 2]).normalize();
        const finalYaw = Math.atan2(-lastTangent.x, -lastTangent.z);
        const camera = this.node as UniversalCamera;
        camera.rotation.x = this.pitchAngle;
        camera.rotation.y = finalYaw;
        camera.rotation.z = 0;

        // Update debug sphere
        if (this.debugSphere) {
          this.debugSphere.position.copyFrom(this.node.position);
        }
        return;
      }

      // Linear interpolation (no easing for constant speed)
      const position = this.interpolateAlongPath(this.pathPoints, t);

      // Log every 60 frames (roughly 1 second at 60fps)
      if (Math.random() < 0.016) {
        console.log("Flyover t:", t.toFixed(3), "pos:", position);
      }

      // Update camera position
      this.node.position.copyFrom(position);

      // Calculate forward direction from path tangent with larger lookahead for smoother rotation
      const currentIndex = Math.floor(t * (this.pathPoints.length - 1));
      const lookahead = 20; // Look ahead 20 points (reduced from 50)
      const nextIndex = Math.min(currentIndex + lookahead, this.pathPoints.length - 1);
      const tangent = this.pathPoints[nextIndex].subtract(this.pathPoints[currentIndex]).normalize();

      // Calculate yaw (rotation around Y axis) from tangent
      const yaw = Math.atan2(-tangent.x, -tangent.z);

      // Smooth rotation using quaternion interpolation
      const targetRotation = Quaternion.RotationYawPitchRoll(yaw, this.pitchAngle, 0);
      const cam = this.node as UniversalCamera;

      // If camera doesn't have rotationQuaternion yet, create it
      if (!cam.rotationQuaternion) {
        cam.rotationQuaternion = Quaternion.RotationYawPitchRoll(cam.rotation.y, cam.rotation.x, cam.rotation.z);
      }

      // Smooth interpolation (slerp) - low factor for smoother motion (0.05-0.08 recommended)
      Quaternion.SlerpToRef(cam.rotationQuaternion, targetRotation, 0.08, cam.rotationQuaternion);

      // Update debug sphere
      if (this.debugSphere) {
        this.debugSphere.position.copyFrom(position);
      }
      break;
    }

    case 'end_pause':
      if (phaseElapsed >= this.endPauseDuration) {
        // End pause complete, restart if looping
        console.log("End pause complete");
        if (this.loop) {
          console.log("Looping - restarting from beginning");
          this.startFlyover();
        } else {
          this.stopFlyover();
        }
      }
      // Stay at end position during pause
      return;
    }
  }

  private interpolateAlongPath(points: Vector3[], t: number): Vector3 {
    if (points.length === 0) {
      return Vector3.Zero();
    }

    if (points.length === 1) {
      return points[0].clone();
    }

    // Map t to segment indices
    const segmentLength = 1.0 / (points.length - 1);
    const segmentIndex = Math.floor(t / segmentLength);
    const localT = (t - segmentIndex * segmentLength) / segmentLength;

    // Clamp to valid range
    const startIndex = Math.min(segmentIndex, points.length - 2);
    const endIndex = startIndex + 1;

    // Simple linear interpolation between points
    const start = points[startIndex];
    const end = points[endIndex];

    return Vector3.Lerp(start, end, localT);
  }

  // Public methods for manual control
  public setDuration(duration: number): void {
    this.duration = duration;
  }

  public setLoop(loop: boolean): void {
    this.loop = loop;
  }

  public isPlaying(): boolean {
    return this.isAnimating;
  }

  public getProgress(): number {
    if (!this.isAnimating) {
      return 0;
    }

    const elapsed = (performance.now() - this.startTime) / 1000;
    return Math.min(elapsed / this.duration, 1.0);
  }
}
