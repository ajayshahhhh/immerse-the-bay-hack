import * as BABYLON from "@babylonjs/core";
import { z } from "zod";
import { BaseBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { NavMeshManager } from "./NavMeshManager";
import { AnimationController } from "../animation/AnimationController";

export enum NPCState {
    IDLE = "IDLE",
    MOVING = "MOVING",
    STUCK = "STUCK",
    REACHED_TARGET = "REACHED_TARGET"
}

export enum MovementMode {
    PATROL = "PATROL",
    FOLLOW_PLAYER = "FOLLOW_PLAYER",
    MOVE_TO_TARGET = "MOVE_TO_TARGET"
}

export enum PatrolDirection {
    FORWARD = 1,
    REVERSE = -1
}

export class NPCPathfinding extends BaseBehavior<BABYLON.TransformNode> {
  public name = "NPCPathfinding";
  public static argsSchema = z.object({
    movementMode: z.enum(["PATROL", "FOLLOW_PLAYER", "MOVE_TO_TARGET"]).describe("Primary movement behavior mode. PATROL: follow patrol points. FOLLOW_PLAYER: continuously follow player. MOVE_TO_TARGET: manual control via moveToTarget() method."),
    walkSpeed: z.number().positive().describe("Movement speed in units per second"),
    rotationSpeed: z.number().positive().describe("How quickly the NPC rotates to face movement direction in radians per second"),
    stoppingDistance: z.number().positive().describe("Distance from target at which the NPC considers it reached"),
    patrolPoints: z.array(z.array(z.number()).length(3)).describe("Array of 3D coordinates [x, y, z] defining patrol route. With 1 point: moves to it and stays. With 2+ points: travels in a loop between them. Only used in PATROL mode."),
    followDistance: z.number().positive().describe("Maximum distance from player before NPC starts following. Only used in FOLLOW_PLAYER mode."),
    pauseAtPatrolPoints: z.number().min(0).describe("Time in seconds to pause at each patrol point. Only used in PATROL mode.")
  }).describe(JSON.stringify({
    summary: "Provides automated movement for individual NPCs using Babylon.js crowd navigation. Supports patrol routes, player following, and programmatic movement control. Integrates with AnimationController for movement animations and uses crowd agents for collision avoidance.",
    whenToAttach: "Attach to NPC entities that need automated movement and pathfinding.",
    requirementsToAttach: "Attach to TransformNode representing the NPC. Assumes the TransformMode has a CustomMesh child, which is the NPC mesh. Requires NavMeshManager to be present in the scene.",
    howToEdit: "Edit the file directly to modify movement logic or add new movement modes. For advanced behaviors like 'patrol until player nearby, then chase', create a separate behavior that monitors player distance and calls setMovementMode() and moveToTarget() to control this behavior externally."
  } satisfies BehaviorMetadata));

  private readonly STUCK_TRIGGER_TIME = 2;
  private readonly STUCK_TRIGGER_SPEED = 0.1;

  // Configuration
  private movementMode: MovementMode;
  private walkSpeed: number;
  private rotationSpeed: number;
  private stoppingDistance: number;
  private patrolPoints: BABYLON.Vector3[];
  private followDistance: number;
  private pauseAtPatrolPoints: number;

  // State
  private currentState: NPCState = NPCState.IDLE;
  private currentTarget: BABYLON.Vector3 | null = null;
  private stuckTimer: number = 0;
  private lastPosition: BABYLON.Vector3 = BABYLON.Vector3.Zero();

  // Patrol specific
  private currentPatrolIndex: number = 0;
  private patrolDirection: PatrolDirection = PatrolDirection.FORWARD;
  private pauseElapsedTime: number = 0;
  private isPaused: boolean = false;

  // Crowd agent
  private agentIndex!: number;

  // References
  private animationController?: AnimationController;

  constructor(args: unknown) {
    super();
    const validatedArgs = NPCPathfinding.argsSchema.parse(args);

    this.movementMode = validatedArgs.movementMode as MovementMode;
    this.walkSpeed = validatedArgs.walkSpeed;
    this.rotationSpeed = validatedArgs.rotationSpeed;
    this.stoppingDistance = validatedArgs.stoppingDistance;
    this.followDistance = validatedArgs.followDistance;
    this.pauseAtPatrolPoints = validatedArgs.pauseAtPatrolPoints;

    // Convert patrol points to Vector3
    this.patrolPoints = validatedArgs.patrolPoints.map(point =>
      new BABYLON.Vector3(point[0], point[1], point[2])
    );
  }

  protected onAwake(): void {
    // Find AnimationController on children
    const children = this.node.getChildren();
    for (const child of children) {
      const animationController = child.behaviors.find(
        b => b instanceof AnimationController
      ) as AnimationController;
      if (animationController) {
        this.animationController = animationController;
        break;
      }
    }
  }

  protected onStart(): void {
    // Create crowd agent
    this.createCrowdAgent();

    // Initialize based on movement mode
    this.initializeMovementMode();
    this.lastPosition = this.node.position.clone();

    // Set up update loop
    this.scene.onBeforeRenderObservable.add(() => {
      this.update();
    });
  }

  protected onDetach(): void {
    // Remove crowd agent
    if (NavMeshManager.instance) {
      NavMeshManager.instance.removeAgent(this.agentIndex);
    }
    this.currentTarget = null;
  }

  private createCrowdAgent(): void {
    if (!NavMeshManager.instance) {
      throw new Error("NavMeshManager instance not found");
    }

    const agentParams = {
      radius: 0.5,
      maxSpeed: this.walkSpeed,
      maxAcceleration: 4.0,
      separationWeight: 1.0
    };

    this.agentIndex = NavMeshManager.instance.createAgent(this.node.position, agentParams, this.node);
  }

  private initializeMovementMode(): void {
    switch (this.movementMode) {
    case MovementMode.PATROL:
      if (this.patrolPoints.length > 0) {
        this.startPatrol();
      } else {
        console.warn("NPCPathfinding: Patrol mode selected but no patrol points defined");
        this.currentState = NPCState.IDLE;
      }
      break;

    case MovementMode.FOLLOW_PLAYER:
      this.startFollowingPlayer();
      break;

    case MovementMode.MOVE_TO_TARGET:
      this.currentState = NPCState.IDLE;
      break;
    }
  }

  private update(): void {
    if (!NavMeshManager.instance) {
      throw new Error("NavMeshManager instance not found");
    }

    // Handle pausing at patrol points
    if (this.isPaused) {
      const deltaTime = this.scene.getEngine().getDeltaTime() / 1000;
      this.pauseElapsedTime += deltaTime;
      if (this.pauseElapsedTime >= this.pauseAtPatrolPoints) {
        this.isPaused = false;
        this.pauseElapsedTime = 0;
        this.continuePatrol();
      }
      return;
    }

    // Check if stuck
    this.checkIfStuck();

    switch (this.currentState) {
    case NPCState.MOVING:
      this.updateMovement();
      break;

    case NPCState.IDLE:
      this.updateIdle();
      break;

    case NPCState.STUCK:
      this.handleStuckState();
      break;

    case NPCState.REACHED_TARGET:
      this.handleReachedTarget();
      break;
    }

    // Update last position for stuck detection
    this.lastPosition = this.node.position.clone();
  }

  private checkIfStuck(): void {
    if (this.currentState === NPCState.MOVING) {
      const deltaTime = this.scene.getEngine().getDeltaTime() / 1000;
      const movement = BABYLON.Vector3.Distance(this.node.position, this.lastPosition);
      const expectedMovement = this.STUCK_TRIGGER_SPEED * deltaTime;

      if (movement < expectedMovement) {
        this.stuckTimer += deltaTime;
        if (this.stuckTimer > this.STUCK_TRIGGER_TIME) {
          this.currentState = NPCState.STUCK;
          this.stuckTimer = 0;
        }
      } else {
        this.stuckTimer = 0;
      }
    }
  }

  private updateMovement(): void {
    if (!NavMeshManager.instance) {
      throw new Error("NavMeshManager instance not found");
    }

    if (!this.currentTarget) {
      this.currentState = NPCState.REACHED_TARGET;
      return;
    }

    // Check if we've reached the target
    const distance = BABYLON.Vector3.Distance(this.node.position, this.currentTarget);
    if (distance <= this.stoppingDistance) {
      this.currentState = NPCState.REACHED_TARGET;
      return;
    }

    // Check if the agent is moving (crowd system handles the actual movement)
    const crowd = NavMeshManager.instance.getCrowd();
    if (!crowd || this.agentIndex === -1) {
      return;
    }
    const agentVelocity = crowd.getAgentVelocity(this.agentIndex);

    // Update rotation to face movement direction
    if (agentVelocity.length() > 0.1) {
      const targetRotation = Math.atan2(agentVelocity.x, agentVelocity.z);
      const currentRotation = this.node.rotation.y;
      const rotationDiff = this.normalizeAngle(targetRotation - currentRotation);

      const deltaTime = this.scene.getEngine().getDeltaTime() / 1000;
      const maxRotation = this.rotationSpeed * deltaTime;
      const actualRotation = Math.sign(rotationDiff) * Math.min(Math.abs(rotationDiff), maxRotation);

      this.node.rotation.y += actualRotation;
    }

    // Update animation based on velocity
    this.updateMovementAnimationFromVelocity(agentVelocity);
  }

  private updateIdle(): void {
    // Update based on movement mode
    switch (this.movementMode) {
    case MovementMode.FOLLOW_PLAYER:
      this.updateFollowPlayer();
      break;

    case MovementMode.PATROL:
      // Should not be idle in patrol mode unless pausing
      break;

    case MovementMode.MOVE_TO_TARGET:
      // Manual control mode stays idle unless given new orders
      break;
    }

    // Set idle animation via state machine
    if (this.animationController) {
      this.animationController.setVariable("directionX", 0);
      this.animationController.setVariable("directionZ", 0);
    }
  }

  private handleStuckState(): void {
    if (!NavMeshManager.instance) {
      throw new Error("NavMeshManager instance not found");
    }

    if (this.currentTarget) {
      NavMeshManager.instance.moveAgent(this.agentIndex, this.currentTarget);
      this.currentState = NPCState.MOVING;
    } else {
      this.currentState = NPCState.IDLE;
    }
  }

  private handleReachedTarget(): void {
    switch (this.movementMode) {
    case MovementMode.PATROL:
      this.handlePatrolTargetReached();
      break;

    case MovementMode.FOLLOW_PLAYER:
      this.currentState = NPCState.IDLE;
      break;

    case MovementMode.MOVE_TO_TARGET:
      this.currentState = NPCState.IDLE;
      break;
    }

    // Set idle animation via state machine
    if (this.animationController) {
      this.animationController.setVariable("directionX", 0);
      this.animationController.setVariable("directionZ", 0);
    }
  }

  private startPatrol(): void {
    if (this.patrolPoints.length === 0) return;

    this.currentPatrolIndex = 0;
    this.moveToPosition(this.patrolPoints[0]);
  }

  private handlePatrolTargetReached(): void {
    if (this.pauseAtPatrolPoints > 0) {
      this.isPaused = true;
      this.pauseElapsedTime = 0;
      this.currentState = NPCState.IDLE;
    } else {
      this.continuePatrol();
    }
  }

  private continuePatrol(): void {
    if (this.patrolPoints.length <= 1) {
      this.currentState = NPCState.IDLE;
      return;
    }

    // Move to next patrol point
    this.currentPatrolIndex += this.patrolDirection;

    // Handle patrol point bounds
    if (this.currentPatrolIndex >= this.patrolPoints.length) {
      this.currentPatrolIndex = this.patrolPoints.length - 2;
      this.patrolDirection = PatrolDirection.REVERSE;
    } else if (this.currentPatrolIndex < 0) {
      this.currentPatrolIndex = 1;
      this.patrolDirection = PatrolDirection.FORWARD;
    }

    this.moveToPosition(this.patrolPoints[this.currentPatrolIndex]);
  }

  private startFollowingPlayer(): void {
    this.updateFollowPlayer();
  }

  private updateFollowPlayer(): void {
    const player = this.scene.getTransformNodeByName("Player") ||
                      this.scene.getTransformNodeByName("player") ||
                      this.scene.getTransformNodeByName("avatar");

    if (!player) {
      return;
    }

    const distanceToPlayer = BABYLON.Vector3.Distance(this.node.position, player.position);

    if (distanceToPlayer > this.followDistance) {
      this.moveToPosition(player.position);
    }
  }

  private moveToPosition(target: BABYLON.Vector3): void {
    if (!NavMeshManager.instance) {
      throw new Error("NavMeshManager instance not found");
    }

    this.currentTarget = target.clone();
    NavMeshManager.instance.moveAgent(this.agentIndex, target);
    this.currentState = NPCState.MOVING;
  }

  private updateMovementAnimationFromVelocity(velocity: BABYLON.Vector3): void {
    if (!this.animationController) return;

    const speed = velocity.length();

    if (speed < 0.1) {
      // Idle
      this.animationController.setVariable("directionX", 0);
      this.animationController.setVariable("directionZ", 0);
    } else {
      // Convert velocity to normalized direction in local space
      // Get the NPC's forward direction
      const forward = this.node.forward;
      const right = this.node.right;

      // Project velocity onto forward and right axes
      const normalizedVelocity = velocity.normalize();
      const forwardComponent = BABYLON.Vector3.Dot(normalizedVelocity, forward);
      const rightComponent = BABYLON.Vector3.Dot(normalizedVelocity, right);

      // Set direction variables for blend node
      this.animationController.setVariable("directionX", rightComponent);
      this.animationController.setVariable("directionZ", -forwardComponent); // Negative because forward is -Z
    }
  }

  private normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

  // Public methods for external control
  public setMovementMode(mode: MovementMode): void {
    this.movementMode = mode;
    this.currentState = NPCState.IDLE;
    this.initializeMovementMode();
  }

  public moveToTarget(target: BABYLON.Vector3): void {
    this.movementMode = MovementMode.MOVE_TO_TARGET;
    this.moveToPosition(target);
  }

  public setPatrolPoints(points: BABYLON.Vector3[]): void {
    this.patrolPoints = points;
    if (this.movementMode === MovementMode.PATROL) {
      this.startPatrol();
    }
  }

  public getCurrentState(): NPCState {
    return this.currentState;
  }

  public stopMovement(): void {
    this.currentState = NPCState.IDLE;
    this.currentTarget = null;
  }
}
