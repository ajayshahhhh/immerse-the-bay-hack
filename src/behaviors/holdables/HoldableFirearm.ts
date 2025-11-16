import {
  Axis,
  Camera,
  Mesh,
  MeshBuilder,
  Observer,
  PhysicsEngineV2,
  PhysicsRaycastResult,
  PointerEventTypes,
  PointerInfo,
  Quaternion,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  Texture,
  Color3
} from "@babylonjs/core";
import { z } from "zod";

import { BaseBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { InputModeManager, InputMode } from "../general/InputModeManager";
import { PrefabManager } from "../general/PrefabManager";

class Bullet {
  public mesh: Mesh;
  public isActive: boolean;
  public initialPosition: Vector3;
  public velocity: Vector3;
  public raycastResult: PhysicsRaycastResult;

  constructor(mesh: Mesh) {
    this.mesh = mesh;
    this.isActive = false;
    this.initialPosition = Vector3.Zero();
    this.velocity = Vector3.Zero();
    this.raycastResult = new PhysicsRaycastResult();
  }

  public activate(position: Vector3, velocity: Vector3): void {
    this.mesh.position.copyFrom(position);
    this.initialPosition.copyFrom(position);
    this.velocity.copyFrom(velocity);
    this.isActive = true;
    this.mesh.setEnabled(true);
  }

  public deactivate(): void {
    this.isActive = false;
    this.mesh.setEnabled(false);
  }

  public getDistanceTraveled(): number {
    return Vector3.Distance(this.initialPosition, this.mesh.position);
  }
}

class Decal {
  public mesh: Mesh | null;
  public isActive: boolean;

  constructor() {
    this.mesh = null;
    this.isActive = false;
  }

  public create(targetMesh: Mesh, position: Vector3, normal: Vector3, radius: number, material: StandardMaterial): void {
    if (this.mesh) {
      this.mesh.dispose();
    }

    this.mesh = MeshBuilder.CreateDecal("decal", targetMesh, {
      position: position,
      normal: normal,
      size: new Vector3(radius, radius, radius),
      angle: Math.random() * Math.PI * 2,
      localMode: true
    });
    this.mesh.material = material;
    this.mesh.material.zOffset = -1;
    this.isActive = true;
  }

  public dispose(): void {
    if (this.mesh) {
      this.mesh.dispose();
      this.mesh = null;
    }
    this.isActive = false;
  }
}

export class HoldableFirearm extends BaseBehavior<TransformNode> {
  public name = "HoldableFirearm";
  public static argsSchema = z.object({
    muzzleEntityId: z.string().describe("Entity ID of the transform node that represents the muzzle position and firing direction of the weapon"),
    autoFire: z.boolean().describe("Whether the weapon fires automatically, true is continuous fire when mouse is held down, false is requires individual clicks per shot"),
    fireDelay: z.number().positive().describe("Delay in seconds between shots, lower value is faster firing rate"),
    hitPrefab: z.string().optional().describe("Prefab to replace hit object with")
  }).describe(JSON.stringify({
    summary: "A firearm behavior that handles weapon shooting mechanics with mouse input and visible bullet projectiles. Features a bullet pool system with 25 visual bullets, raycast hit detection, and impact indicators. Supports both semi-automatic and automatic firing modes. Bullets are visible elongated boxes that travel from muzzle to target with configurable speed and show hit spheres on impact.",
    whenToAttach: "Attach to the root entity of weapon prefabs like Revolver or AK47. Used when creating shootable firearms in first-person or third-person games.",
    requirementsToAttach: "Must be attached to a `standard/TransformNode` that represents the weapon root. Requires a child entity representing the muzzle position. InputModeManager must exist for input handling.",
    howToEdit: "Edit the file directly."
  } satisfies BehaviorMetadata));

  private pointerObserver: Observer<PointerInfo> | null = null;
  private beforePhysicsObserver: Observer<Scene> | null = null;

  private physicsEngine!: PhysicsEngineV2;
  private camera!: Camera;

  private muzzleEntityId: string;
  private muzzleEntity: TransformNode | null = null;

  private autoFire: boolean;
  private fireDelay: number;

  private isMouseDown: boolean = false;
  private lastFireTime: number = 0;

  // Constants
  private readonly BULLET_MAX_INSTANCES = 30;
  private readonly BULLET_SPREAD_RADIUS = 0.03;
  private readonly BULLET_SPEED = 50;
  private readonly BULLET_MESH_DIAMETER = 0.03;
  private readonly BULLET_MESH_LENGTH = 0.01 * this.BULLET_SPEED;
  private readonly BULLET_RAYCAST_LENGTH = 0.02 * this.BULLET_SPEED;
  private readonly BULLET_DESPAWN_DISTANCE = 1000;
  private readonly BULLET_GRAVITY = 0;
  private readonly BULLET_IMPACT_FORCE = 3000;

  // Decal constants
  private readonly DECAL_MAX_INSTANCES = 25;
  private readonly DECAL_RADIUS = 0.3;

  // Bullet system
  private bullets: Bullet[] = [];
  private nextBulletIndex: number = 0;

  // Decal system
  private decals: Decal[] = [];
  private nextDecalIndex: number = 0;

  // Materials
  private bulletMaterial!: StandardMaterial;
  private decalMaterial!: StandardMaterial;

  private hitPrefab: string | null = null;

  constructor(args: unknown) {
    super();
    const validatedArgs = HoldableFirearm.argsSchema.parse(args);
    this.muzzleEntityId = validatedArgs.muzzleEntityId;
    this.autoFire = validatedArgs.autoFire;
    this.fireDelay = validatedArgs.fireDelay;

    if(validatedArgs.hitPrefab){
      this.hitPrefab = validatedArgs.hitPrefab;
    }

  }

  protected onAwake(): void {
    // Get physics engine reference
    const physicsEngine = this.scene.getPhysicsEngine();
    if (!physicsEngine) {
      throw new Error("Physics engine not found");
    }
    this.physicsEngine = physicsEngine as PhysicsEngineV2;

    // Get active camera reference
    const camera = this.scene.activeCamera;
    if (!camera) {
      throw new Error("Active camera not found");
    }
    this.camera = camera;

    // Find the muzzle entity by ID
    this.muzzleEntity = this.scene.getNodeById(this.muzzleEntityId) as TransformNode;
    if (!this.muzzleEntity) {
      throw new Error(`Muzzle entity with ID ${this.muzzleEntityId} not found`);
    }

    // Create materials
    this.bulletMaterial = new StandardMaterial("bullet_material", this.scene);
    this.bulletMaterial.emissiveColor = new Color3(0.8, 0.8, 0.3);

    this.decalMaterial = new StandardMaterial("decal_material", this.scene);
    this.decalMaterial.diffuseTexture = new Texture("https://spatio-generations.s3.us-east-1.amazonaws.com/misc/bullet_impact.png", this.scene);
    this.decalMaterial.diffuseTexture.hasAlpha = true;
    this.decalMaterial.useAlphaFromDiffuseTexture = true;

    // Create bullet pool exactly like the example
    this.createBulletPool();

    // Create decal pool
    this.createDecalPool();
  }

  protected onStart(): void {
    // Register pointer events for mouse input
    this.pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
      if (!InputModeManager.instance) {
        throw new Error("InputModeManager instance not found");
      }
      if (InputModeManager.instance.getCurrentMode() !== InputMode.GAMEPLAY) {
        return;
      }

      switch (pointerInfo.type) {
      case PointerEventTypes.POINTERDOWN:
        this.isMouseDown = true;
        this.attemptFire();
        break;
      case PointerEventTypes.POINTERUP:
        this.isMouseDown = false;
        break;
      }
    });

    // Set up firing update loop
    this.beforePhysicsObserver = this.scene.onBeforePhysicsObservable.add(() => {
      if (!InputModeManager.instance) {
        throw new Error("InputModeManager instance not found");
      }
      if (InputModeManager.instance.getCurrentMode() !== InputMode.GAMEPLAY) {
        return;
      }

      if (this.autoFire && this.isMouseDown) {
        this.attemptFire();
      }
      this.updateBulletPositions();
      this.updateBulletHits();
    });
  }

  protected onDetach(): void {
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
      this.pointerObserver = null;
    }
    if (this.beforePhysicsObserver) {
      this.scene.onBeforePhysicsObservable.remove(this.beforePhysicsObserver);
      this.beforePhysicsObserver = null;
    }

    for (const bullet of this.bullets) {
      bullet.mesh.dispose();
    }

    for (const decal of this.decals) {
      decal.dispose();
    }
  }

  private createBulletPool(): void {
    for (let i = 0; i < this.BULLET_MAX_INSTANCES; i++) {
      const mesh = MeshBuilder.CreateBox("bullet", {
        width: this.BULLET_MESH_DIAMETER,
        height: this.BULLET_MESH_DIAMETER,
        depth: this.BULLET_MESH_LENGTH
      }, this.scene);
      mesh.material = this.bulletMaterial;
      mesh.renderingGroupId = 0;
      mesh.position = Vector3.Zero();
      mesh.setEnabled(false);

      this.bullets[i] = new Bullet(mesh);
    }
  }

  private createDecalPool(): void {
    for (let i = 0; i < this.DECAL_MAX_INSTANCES; i++) {
      this.decals[i] = new Decal();
    }
  }

  private attemptFire(): void {
    const currentTime = performance.now() / 1000;
    const timeSinceLastFire = currentTime - this.lastFireTime;

    // Check if enough time has passed based on fire rate
    if (timeSinceLastFire >= this.fireDelay) {
      this.fire();
      this.lastFireTime = currentTime;
    }
  }

  private fire(): void {
    if (!this.muzzleEntity) {
      throw new Error("Muzzle entity not found");
    }

    const bullet = this.bullets[this.nextBulletIndex];
    const muzzlePosition = this.muzzleEntity.getAbsolutePosition();

    // Get camera position and direction
    const cameraPosition = this.camera.globalPosition;
    const cameraDirection = this.camera.getDirection(Axis.Z).negate();
    const raycastResult = new PhysicsRaycastResult();

    // Cast ray to find what the camera is looking at
    const rayEnd = cameraPosition.add(cameraDirection.scale(1000));
    this.physicsEngine.raycastToRef(cameraPosition, rayEnd, raycastResult);

    // Determine target point
    let targetPoint: Vector3;
    if (raycastResult.hasHit && raycastResult.hitPointWorld) {
      // If ray hit something, use that point
      targetPoint = raycastResult.hitPointWorld;
    } else {
      // If ray didn't hit anything, use a point far in the camera's forward direction
      targetPoint = rayEnd;
    }

    // Calculate direction from muzzle to target point
    const baseDirection = targetPoint.subtract(muzzlePosition).normalize();

    // Set bullet orientation to face the direction it's traveling
    bullet.mesh.rotationQuaternion = Quaternion.FromLookDirectionRH(baseDirection, Vector3.Up());

    // Add random spread within cone
    const spreadX = (Math.random() - 0.5) * this.BULLET_SPREAD_RADIUS;
    const spreadY = (Math.random() - 0.5) * this.BULLET_SPREAD_RADIUS;

    const spreadDirection = baseDirection.clone();
    spreadDirection.x += spreadX;
    spreadDirection.y += spreadY;
    spreadDirection.normalize();

    const velocity = spreadDirection.scale(this.BULLET_SPEED);

    // Activate the bullet
    bullet.activate(muzzlePosition, velocity);

    // Cycle to next bullet
    this.nextBulletIndex = (this.nextBulletIndex + 1) % this.BULLET_MAX_INSTANCES;
  }

  private updateBulletPositions(): void {
    // Use scene delta time for consistent movement
    const deltaTime = this.scene.getEngine().getDeltaTime() / 1000;

    for (const bullet of this.bullets) {
      // Skip inactive bullets entirely
      if (!bullet.isActive) {
        continue;
      }

      // Apply gravity to velocity
      bullet.velocity.y -= this.BULLET_GRAVITY * deltaTime;

      // Move bullet based on current velocity
      const movement = bullet.velocity.scale(deltaTime);
      bullet.mesh.position.addInPlace(movement);

      // Check if bullet exceeded range
      if (bullet.getDistanceTraveled() > this.BULLET_DESPAWN_DISTANCE) {
        bullet.deactivate();
      }
    }
  }

  private updateBulletHits(): void {
    for (const bullet of this.bullets) {
      // Only check hits for active bullets
      if (!bullet.isActive) {
        continue;
      }

      // Perform physics raycast from bullet position forward
      const bulletPos = bullet.mesh.position;
      const bulletForward = bullet.mesh.forward.scale(this.BULLET_RAYCAST_LENGTH);
      const rayEnd = bulletPos.add(bulletForward);

      // Use physics engine raycast - only hits objects with PhysicsShape
      this.physicsEngine.raycastToRef(bulletPos, rayEnd, bullet.raycastResult);

      if (bullet.raycastResult.hasHit) {
        if (bullet.raycastResult.body && bullet.raycastResult.body.transformNode instanceof Mesh && bullet.raycastResult.body.transformNode.getClassName() !== "GroundMesh") {
          // Create decal at hit position
          console.log("Firearm hit");
          if(this.hitPrefab){
            this.prefabReplace(bullet.raycastResult);
            console.log("Firearm prefab replace");
          }else{
            this.createDecal(bullet.raycastResult);
          
            // Apply impact force to hit object
            this.applyBulletImpact(bullet.velocity, bullet.raycastResult);
          }
        }

        // Deactivate the bullet after hit
        bullet.deactivate();
      }
    }
  }

  private prefabReplace(raycastResult: PhysicsRaycastResult): void {
    if(!this.hitPrefab) return;

    const node = raycastResult.body!.transformNode;
    if(node){
      node.dispose();
    }

    PrefabManager.instance?.instantiatePrefab(this.hitPrefab, this.hitPrefab + "_from_shot", {},
      [raycastResult.hitPointWorld.x,raycastResult.hitPointWorld.y,raycastResult.hitPointWorld.z]
    );
  }

  private createDecal(raycastResult: PhysicsRaycastResult): void {
    // Use the next decal in the rotating array
    const decal = this.decals[this.nextDecalIndex];

    // Create the decal at the hit position
    decal.create(
			raycastResult.body!.transformNode as Mesh,
			raycastResult.hitPointWorld,
			raycastResult.hitNormalWorld,
			this.DECAL_RADIUS,
			this.decalMaterial
    );

    // Cycle to next decal
    this.nextDecalIndex = (this.nextDecalIndex + 1) % this.DECAL_MAX_INSTANCES;
  }

  private applyBulletImpact(velocity: Vector3, raycastResult: PhysicsRaycastResult): void {
    // Apply impact force to the hit object
    const direction = velocity.normalize();
    const impactForce = direction.scale(this.BULLET_IMPACT_FORCE);
		raycastResult.body!.applyImpulse(impactForce, raycastResult.hitPointWorld);
  }
}
