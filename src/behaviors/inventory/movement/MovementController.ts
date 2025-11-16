import {
  ActionManager,
  CharacterSupportedState,
  Mesh,
  Observer,
  PhysicsCharacterController,
  PhysicsEngineV2,
  PhysicsRaycastResult,
  Quaternion,
  Scene,
  Vector3,
} from "@babylonjs/core";
import { z } from "zod";

import { BaseBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { InputModeManager, InputMode } from "../general/InputModeManager";
import { AnimationController } from "../animation/AnimationController";

enum MovementState {
	IN_AIR = "IN_AIR",
	ON_GROUND = "ON_GROUND",
	START_JUMP = "START_JUMP"
}

export class MovementController extends BaseBehavior<Mesh> {
  public name = "MovementController";
  public static argsSchema = z.object({
    walkSpeed: z.number().positive().default(3).describe("Speed of walking movement in units per second"),
    runSpeed: z.number().positive().default(6).describe("Speed of running movement in units per second when shift is held"),
    jumpHeight: z.number().positive().default(2).describe("Maximum height of jump in units"),
    capsuleHeight: z.number().positive().default(2).describe("Height of physics collision capsule for character controller"),
    capsuleRadius: z.number().positive().default(0.5).describe("Radius of physics collision capsule for character controller")
  }).describe(JSON.stringify({
    summary: "A physics-based movement controller with WASD input for first and third-person games. Features character controller physics with support for walking, running, jumping, gravity, and smooth animation integration. Handles ground detection, air movement, and communicates movement state to AnimationController for seamless character animation.",
    whenToAttach: "Is part of player prefabs, should not be used directly. Use ThirdPersonPlayer or FirstPersonPlayer prefabs instead.",
    requirementsToAttach: "Must be placed on the root character entity. Requires a child entity with AnimationController behavior for animated characters. InputModeManager must exist for input handling.",
    howToEdit: "Edit the file directly."
  } satisfies BehaviorMetadata));

  private afterPhysicsObserver: Observer<Scene> | null = null;
  private beforeRenderObserver: Observer<Scene> | null = null;

  // References
  private physicsEngine!: PhysicsEngineV2;
  private characterController!: PhysicsCharacterController;
  private animationController?: AnimationController;

  // State
  private state: MovementState = MovementState.IN_AIR;
  protected characterOrientation: Quaternion = Quaternion.Identity();
  private jumpAnimationRaycastResult: PhysicsRaycastResult = new PhysicsRaycastResult();
  private readonly jumpAnimationRaycastDistance: number = 0.5;

  // Input
  private pressedKeys: Set<string> = new Set();
  private inputDirection: Vector3 = new Vector3(0, 0, 0);
  private inputRun: boolean = false;
  private inputJump: boolean = false;
  private jumpRequested: boolean = false;

  // Config
  private walkSpeed: number;
  private runSpeed: number;
  private jumpHeight: number;
  protected capsuleHeight: number;
  protected capsuleRadius: number;

  constructor(args: unknown) {
    super();
    const validatedArgs = MovementController.argsSchema.parse(args);
    this.walkSpeed = validatedArgs.walkSpeed;
    this.runSpeed = validatedArgs.runSpeed;
    this.jumpHeight = validatedArgs.jumpHeight;
    this.capsuleHeight = validatedArgs.capsuleHeight;
    this.capsuleRadius = validatedArgs.capsuleRadius;
  }

  protected onAwake(): void {
    const physicsEngine = this.scene.getPhysicsEngine();
    if (!physicsEngine) {
      throw new Error("Physics engine not found");
    }
    this.physicsEngine = physicsEngine as PhysicsEngineV2;
  }

  protected onStart(): void {
    if (!InputModeManager.instance) {
      throw new Error("InputModeManager instance not found");
    }

    // Register gameplay actions with InputModeManager
    InputModeManager.instance.registerAction(
      InputMode.GAMEPLAY,
      ActionManager.OnKeyDownTrigger,
      (evt) => {
        this.pressedKeys.add(evt.sourceEvent.code);
        // Only trigger jump on fresh spacebar press, not when held
        if (evt.sourceEvent.code === "Space" && !this.inputJump) {
          this.inputJump = true;
          this.jumpRequested = true;
        }
        this.updateDirectionalInput();
      },
      this.name
    );
    InputModeManager.instance.registerAction(
      InputMode.GAMEPLAY,
      ActionManager.OnKeyUpTrigger,
      (evt) => {
        this.pressedKeys.delete(evt.sourceEvent.code);
        // Reset spacebar state when released
        if (evt.sourceEvent.code === "Space") {
          this.inputJump = false;
        }
        this.updateDirectionalInput();
      },
      this.name
    );

    // Find AnimationController on child nodes (where the GLB mesh is)
    const children = this.node.getChildren();
    for (const child of children) {
      const animationController = child.behaviors?.find(
        b => b instanceof AnimationController
      ) as AnimationController;
      if (animationController) {
        this.animationController = animationController;
        break;
      }
    }

    // Create character controller
    this.characterController = new PhysicsCharacterController(
      this.node.position.clone().add(new Vector3(0, this.capsuleHeight / 2, 0)), {
        capsuleHeight: this.capsuleHeight,
        capsuleRadius: this.capsuleRadius,
      },
      this.scene,
    );

    // Set up physics update callback
    this.afterPhysicsObserver = this.scene.onAfterPhysicsObservable.add(() => {
      this.physicsUpdate();
    });

    // Set up render update callback
    this.beforeRenderObserver = this.scene.onBeforeRenderObservable.add(() => {
      this.renderUpdate();
    });
  }

  protected onDetach(): void {
    if (this.afterPhysicsObserver) {
      this.scene.onAfterPhysicsObservable.remove(this.afterPhysicsObserver);
      this.afterPhysicsObserver = null;
    }
    if (this.beforeRenderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.beforeRenderObserver);
      this.beforeRenderObserver = null;
    }
    if (InputModeManager.instance) {
      InputModeManager.instance.unregisterActionsForBehavior(this.name);
    }
  }

  private updateDirectionalInput(): void {
    // Reset input direction
    this.inputDirection.setAll(0);

    // Calculate movement input based on currently pressed keys
    if (this.pressedKeys.has("KeyW") || this.pressedKeys.has("ArrowUp")) {
      this.inputDirection.z -= 1;
    }
    if (this.pressedKeys.has("KeyS") || this.pressedKeys.has("ArrowDown")) {
      this.inputDirection.z += 1;
    }
    if (this.pressedKeys.has("KeyA") || this.pressedKeys.has("ArrowLeft")) {
      this.inputDirection.x -= 1;
    }
    if (this.pressedKeys.has("KeyD") || this.pressedKeys.has("ArrowRight")) {
      this.inputDirection.x += 1;
    }

    // Handle run input
    this.inputRun = this.pressedKeys.has("ShiftLeft") || this.pressedKeys.has("ShiftRight");

    // Normalize diagonal movement to prevent faster diagonal speed
    if (this.inputDirection.length() > 1) {
      this.inputDirection.normalize();
    }
  }

  private getNextState(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supportInfo: any,
  ): MovementState {
    if (this.state === MovementState.IN_AIR) {
      if (supportInfo.supportedState === CharacterSupportedState.SUPPORTED) {
        return MovementState.ON_GROUND;
      }
      return MovementState.IN_AIR;
    } else if (this.state === MovementState.ON_GROUND) {
      if (supportInfo.supportedState !== CharacterSupportedState.SUPPORTED) {
        return MovementState.IN_AIR;
      }
      if (this.jumpRequested) {
        return MovementState.START_JUMP;
      }
      return MovementState.ON_GROUND;
    } else if (this.state === MovementState.START_JUMP) {
      return MovementState.IN_AIR;
    }
    return this.state;
  }

  private getDesiredVelocity(
    deltaTime: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supportInfo: any,
    characterOrientation: Quaternion,
    currentVelocity: Vector3,
  ): Vector3 {
    if (!this.scene.getPhysicsEngine()) {
      throw new Error("Physics engine not defined");
    }

    const nextState = this.getNextState(supportInfo);
    if (nextState !== this.state) {
      this.state = nextState;
      // Reset jumpRequested after it's consumed for the jump
      if (this.state === MovementState.START_JUMP) {
        this.jumpRequested = false;
      }
    }

    const upWorld = this.physicsEngine.gravity.normalizeToNew();
    upWorld.scaleInPlace(-1.0);
    const forwardWorld = new Vector3(0, 0, 1).applyRotationQuaternion(characterOrientation);

    // Determine current speed based on running state
    const currentSpeed = this.inputRun ? this.runSpeed : this.walkSpeed;

    if (this.state === MovementState.IN_AIR) {
      const desiredVelocity = this.inputDirection
        .scale(currentSpeed)
        .applyRotationQuaternion(characterOrientation);
      const outputVelocity = this.characterController.calculateMovement(
        deltaTime,
        forwardWorld,
        upWorld,
        currentVelocity,
        Vector3.ZeroReadOnly,
        desiredVelocity,
        upWorld,
      );

      // Restore to original vertical component
      outputVelocity.addInPlace(upWorld.scale(-outputVelocity.dot(upWorld)));
      outputVelocity.addInPlace(upWorld.scale(currentVelocity.dot(upWorld)));

      // Add gravity
      outputVelocity.addInPlace(this.physicsEngine.gravity.scale(deltaTime));
      return outputVelocity;
    } else if (this.state === MovementState.ON_GROUND) {
      const desiredVelocity = this.inputDirection
        .scale(currentSpeed)
        .applyRotationQuaternion(characterOrientation);
      const outputVelocity = this.characterController.calculateMovement(
        deltaTime,
        forwardWorld,
        supportInfo.averageSurfaceNormal,
        currentVelocity,
        supportInfo.averageSurfaceVelocity,
        desiredVelocity,
        upWorld,
      );

      // Horizontal projection
      outputVelocity.subtractInPlace(supportInfo.averageSurfaceVelocity);
      const inv1k = 1e-3;
      if (outputVelocity.dot(upWorld) > inv1k) {
        const velLen = outputVelocity.length();
        outputVelocity.normalizeFromLength(velLen);

        // Get the desired length in the horizontal direction
        const horizLen = velLen / supportInfo.averageSurfaceNormal.dot(upWorld);

        // Re project the velocity onto the horizontal plane
        const c = supportInfo.averageSurfaceNormal.cross(outputVelocity);
        outputVelocity.copyFrom(c.cross(upWorld));
        outputVelocity.scaleInPlace(horizLen);
      }
      outputVelocity.addInPlace(supportInfo.averageSurfaceVelocity);
      return outputVelocity;
    } else if (this.state === MovementState.START_JUMP) {
      const u = Math.sqrt(2 * this.physicsEngine.gravity.length() * this.jumpHeight);
      const curRelVel = currentVelocity.dot(upWorld);
      return currentVelocity.add(upWorld.scale(u - curRelVel));
    }
    return Vector3.Zero();
  }

  protected physicsUpdate(): void {
    if (!InputModeManager.instance) {
      throw new Error("InputModeManager instance not found");
    }

    const dt = this.scene.deltaTime / 1000.0;
    if (dt === 0) {
      return;
    }

    // Only process movement in gameplay mode
    if (InputModeManager.instance.getCurrentMode() !== InputMode.GAMEPLAY) {
      // Clear input when not in gameplay mode
      this.clearMovementState();
      this.updateAnimation();
      return;
    }

    const support = this.characterController.checkSupport(dt, new Vector3(0, -1, 0));

    const desiredLinearVelocity = this.getDesiredVelocity(
      dt,
      support,
      this.characterOrientation,
      this.characterController.getVelocity(),
    );
    this.characterController.setVelocity(desiredLinearVelocity);
    this.characterController.integrate(dt, support, this.physicsEngine.gravity);

    // Perform downward raycast to check for ground
    const feetPos = this.characterController.getPosition().add(new Vector3(0, -this.capsuleHeight / 2 - 0.01, 0));
    const rayStart = feetPos.clone();
    const rayEnd = feetPos.add(new Vector3(0, -this.jumpAnimationRaycastDistance, 0));
    this.physicsEngine.raycastToRef(rayStart, rayEnd, this.jumpAnimationRaycastResult);

    // Update animation based on movement state
    this.updateAnimation();
  }

  protected renderUpdate(): void {
    this.node.position.copyFrom(this.characterController.getPosition().subtract(new Vector3(0, this.capsuleHeight / 2, 0)));
  }

  private updateAnimation(): void {
    if (!this.animationController) {
      return;
    }

    // Set isJumping variable - only if in air AND no ground detected within raycast distance
    const isJumping = (this.state === MovementState.START_JUMP || this.state === MovementState.IN_AIR)
      && !this.jumpAnimationRaycastResult.hasHit;
    this.animationController.setVariable("isJumping", isJumping);

    // Set directionX and directionZ variables
    // Scale by 1 for walking, 2 for running
    const speedMultiplier = this.inputRun ? 2 : 1;
    this.animationController.setVariable("directionX", this.inputDirection.x * speedMultiplier);
    this.animationController.setVariable("directionZ", this.inputDirection.z * speedMultiplier);
  }

  public setCharacterOrientation(orientation: Quaternion): void {
    this.characterOrientation = orientation;
    this.node.rotationQuaternion = orientation.clone();
  }

  public clearMovementState(): void {
    this.pressedKeys.clear();
    this.inputDirection.setAll(0);
    this.inputRun = false;
    this.inputJump = false;
    this.jumpRequested = false;
  }
}
