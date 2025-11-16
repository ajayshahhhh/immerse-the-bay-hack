import * as BABYLON from "@babylonjs/core";
import { z } from "zod";
import { BaseSingletonBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";

export class NavMeshManager extends BaseSingletonBehavior<BABYLON.TransformNode> {
  public name = "NavMeshManager";
  public static argsSchema = z.object({
    walkableSlopeAngle: z.number().min(0).max(90).describe("Maximum slope angle in degrees that agents can walk on. Surfaces steeper than this will be considered unwalkable."),
    walkableHeight: z.number().positive().describe("Minimum height clearance required for walkable areas"),
    walkableClimb: z.number().positive().describe("Maximum step height that agents can climb"),
    walkableRadius: z.number().positive().describe("Agent radius used for generating walkable areas with appropriate clearance")
  }).describe(JSON.stringify({
    summary: "Singleton behavior that manages navigation mesh generation using Babylon.js RecastJS plugin and crowd navigation for NPCs. Automatically generates navigation meshes from meshes with STATIC physics motion and provides crowd-based pathfinding services. Access via NavMeshManager.instance to create and manage navigation agents.",
    whenToAttach: "Attach to any entity when navigation and pathfinding functionality is needed for NPCs or AI agents.",
    requirementsToAttach: "Must be placed on the `_managers` entity.",
    howToEdit: "Edit the file directly to modify navmesh generation parameters or crowd management logic."
  } satisfies BehaviorMetadata));

  public static instance: NavMeshManager | null = null;

  private readonly SHOW_NAVMESH_DEBUG = false;
  private readonly MAX_CROWD_AGENTS = 30;
  private readonly MAX_CROWD_RADIUS = 0.5;

  private navMeshDebug: BABYLON.Mesh | null = null;

  private walkableSlopeAngle: number;
  private walkableHeight: number;
  private walkableClimb: number;
  private walkableRadius: number;

  private navigationPlugin!: BABYLON.RecastJSPlugin;
  private crowd!: BABYLON.ICrowd;

  constructor(args: unknown) {
    super();
    const validatedArgs = NavMeshManager.argsSchema.parse(args);
    this.walkableSlopeAngle = validatedArgs.walkableSlopeAngle;
    this.walkableHeight = validatedArgs.walkableHeight;
    this.walkableClimb = validatedArgs.walkableClimb;
    this.walkableRadius = validatedArgs.walkableRadius;
  }

  public loadData(): void {}

  protected onAwake(): void {
    this.createNavMesh();
  }

  protected onStart(): void {}

  protected onDetach(): void {
    if (this.navigationPlugin) {
      this.navigationPlugin.dispose();
    }
    if (this.navMeshDebug) {
      this.navMeshDebug.dispose();
    }
  }

  private async createNavMesh(): Promise<void> {
    if (!this.scene.metadata.navigationPlugin) {
      throw new Error("Navigation plugin not found in scene.metadata");
    }
    this.navigationPlugin = this.scene.metadata.navigationPlugin;

    const staticMeshes = this.scene.meshes.filter((mesh): mesh is BABYLON.Mesh => {
      if (!(mesh instanceof BABYLON.Mesh)) return false;
      if (mesh.physicsBody?.getMotionType() !== BABYLON.PhysicsMotionType.STATIC) return false;
      if (!mesh.isEnabled()) return false;
      if (!mesh.isVisible) return false;
      return true;
    });

    const parameters: BABYLON.INavMeshParameters = {
      cs: 0.2,
      ch: 0.2,
      walkableSlopeAngle: this.walkableSlopeAngle,
      walkableHeight: this.walkableHeight,
      walkableClimb: this.walkableClimb,
      walkableRadius: this.walkableRadius,
      maxEdgeLen: 12,
      maxSimplificationError: 1.3,
      minRegionArea: 8,
      mergeRegionArea: 20,
      maxVertsPerPoly: 6,
      detailSampleDist: 6,
      detailSampleMaxError: 1,
    };

    // Always create navmesh (even if empty) so getNavMesh() doesn't return undefined
    this.navigationPlugin.createNavMesh(staticMeshes, parameters);

    this.crowd = this.navigationPlugin.createCrowd(
      this.MAX_CROWD_AGENTS,
      this.MAX_CROWD_RADIUS,
      this.scene
    );

    if (this.SHOW_NAVMESH_DEBUG) {
      this.navMeshDebug = this.navigationPlugin.createDebugNavMesh(this.scene);
      const matdebug = new BABYLON.StandardMaterial("navmesh_debug", this.scene);
      matdebug.diffuseColor = new BABYLON.Color3(0, 1, 0);
      matdebug.alpha = 0.7;
      this.navMeshDebug.material = matdebug;
    }
  }

  // Public API for NPCs to use
  public createAgent(position: BABYLON.Vector3, agentParameters: Partial<BABYLON.IAgentParameters>, transform: BABYLON.TransformNode): number {
    if (!this.crowd) {
      console.warn("NavMeshManager: Cannot create agent, crowd not initialized");
      return -1;
    }

    const navmeshPosition = this.navigationPlugin.getClosestPoint(position);

    return this.crowd.addAgent(navmeshPosition, {
      radius: 0.5,
      height: 1.0,
      maxSpeed: 1.5,
      maxAcceleration: 4.0,
      collisionQueryRange: 0.5,
      pathOptimizationRange: 0.0,
      separationWeight: 1.0,
      ...agentParameters
    }, transform);
  }

  public moveAgent(agentIndex: number, targetPosition: BABYLON.Vector3): void {
    if (!this.crowd || agentIndex === -1) {
      return;
    }

    const navmeshTarget = this.navigationPlugin.getClosestPoint(targetPosition);
    this.crowd.agentGoto(agentIndex, navmeshTarget);
  }

  public removeAgent(agentIndex: number): void {
    this.crowd.removeAgent(agentIndex);
  }

  public teleportAgent(agentIndex: number, position: BABYLON.Vector3): void {
    const navmeshPosition = this.navigationPlugin.getClosestPoint(position);
    this.crowd.agentTeleport(agentIndex, navmeshPosition);
  }

  public getClosestPoint(position: BABYLON.Vector3): BABYLON.Vector3 {
    return this.navigationPlugin.getClosestPoint(position);
  }

  public getRandomPointAround(origin: BABYLON.Vector3, maxRadius: number): BABYLON.Vector3 {
    return this.navigationPlugin.getRandomPointAround(origin, maxRadius);
  }

  public isPointOnNavMesh(position: BABYLON.Vector3, tolerance: number = 0.1): boolean {
    const closestPoint = this.navigationPlugin.getClosestPoint(position);
    return BABYLON.Vector3.Distance(position, closestPoint) <= tolerance;
  }

  public getCrowd(): BABYLON.ICrowd {
    return this.crowd;
  }

  public getNavigationPlugin(): BABYLON.RecastJSPlugin {
    return this.navigationPlugin;
  }
}
