import {
  ActionManager,
  Observer,
  PointerEventTypes,
  PointerInfo,
  Scene,
  UniversalCamera,
  Vector3,
} from "@babylonjs/core";

import { BaseBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { z } from "zod";
import { InputModeManager, InputMode } from "../general/InputModeManager";

export class FreeCamera extends BaseBehavior<UniversalCamera> {
  public name = "FreeCamera";
  public static argsSchema = z.object({
    mouseSensitivity: z.number().positive().default(2).describe("Mouse sensitivity for camera movement, higher value is more sensitive"),
    moveSpeed: z.number().positive().default(10).describe("Movement speed in units per second"),
    smoothness: z.number().positive().default(10).describe("Camera rotation smoothness, higher value is more responsive, lower value is smoother"),
  }).describe(JSON.stringify({
    summary: "A free-flying camera with game editor-style controls. Use WASD to move horizontally, Space to move up, and Shift to move down. Mouse controls camera rotation with pitch clamping. Operates independently without requiring MovementController.",
    whenToAttach: "Attach to any `standard/UniversalCamera` entity for free-flying camera controls, commonly used for editor-style navigation or spectator mode.",
    requirementsToAttach: "Must be attached to a `standard/UniversalCamera` entity. Requires InputModeManager for input mode detection.",
    howToEdit: "Edit the file directly."
  } satisfies BehaviorMetadata));

  private pointerObserver: Observer<PointerInfo> | null = null;
  private beforeRenderObserver: Observer<Scene> | null = null;
  private pressedKeys: Set<string> = new Set();

  private mouseSensitivity: number;
  private moveSpeed: number;
  private smoothness: number;
  private yaw: number = 0;
  private pitch: number = 0;
  private targetYaw: number = 0;
  private targetPitch: number = 0;

  // Check if device is mobile
  private get isMobile(): boolean {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  constructor(args: unknown) {
    super();
    const validatedArgs = FreeCamera.argsSchema.parse(args);
    this.mouseSensitivity = validatedArgs.mouseSensitivity;
    this.moveSpeed = validatedArgs.moveSpeed;
    this.smoothness = validatedArgs.smoothness;
  }

  protected onAwake(): void {
    // Initialize yaw & pitch from current camera rotation
    this.yaw = this.node.rotation.y;
    this.pitch = this.node.rotation.x;
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
  }

  protected onStart(): void {
    if (!InputModeManager.instance) {
      throw new Error("InputModeManager instance not found");
    }

    this.updateCameraRotation();

    // Register keyboard input with InputModeManager
    InputModeManager.instance.registerAction(
      InputMode.GAMEPLAY,
      ActionManager.OnKeyDownTrigger,
      (evt) => {
        this.pressedKeys.add(evt.sourceEvent.code);
      },
      this.name
    );
    InputModeManager.instance.registerAction(
      InputMode.GAMEPLAY,
      ActionManager.OnKeyUpTrigger,
      (evt) => {
        this.pressedKeys.delete(evt.sourceEvent.code);
      },
      this.name
    );

    // Mouse look
    this.pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
      const canvas = this.scene.getEngine().getRenderingCanvas();

      // On mobile, skip pointer lock check; on desktop, require pointer lock
      const hasPointerLock = this.isMobile || document.pointerLockElement === canvas;
      const canProcessInput = hasPointerLock && InputModeManager.instance?.getCurrentMode() === InputMode.GAMEPLAY;

      if (canProcessInput && pointerInfo.type === PointerEventTypes.POINTERMOVE) {
        const evt = pointerInfo.event as MouseEvent;
        this.targetYaw -= evt.movementX * this.mouseSensitivity / 1000;
        this.targetPitch -= evt.movementY * this.mouseSensitivity / 1000;

        // Clamp pitch between straight up and down
        const limit = Math.PI / 2 - 0.01;
        if (this.targetPitch > limit) this.targetPitch = limit;
        if (this.targetPitch < -limit) this.targetPitch = -limit;
      }
    }, PointerEventTypes.POINTERMOVE);

    // Set up render update callback for movement
    this.beforeRenderObserver = this.scene.onBeforeRenderObservable.add(() => {
      this.renderUpdate();
    });
  }

  private renderUpdate(): void {
    if (!InputModeManager.instance) {
      return;
    }

    // Only process movement in gameplay mode
    if (InputModeManager.instance.getCurrentMode() !== InputMode.GAMEPLAY) {
      return;
    }

    // Smoothly interpolate rotation toward target
    const deltaTime = this.scene.getEngine().getDeltaTime();
    const lerpFactor = Math.min(1, (this.smoothness * deltaTime) / 1000);
    this.yaw += (this.targetYaw - this.yaw) * lerpFactor;
    this.pitch += (this.targetPitch - this.pitch) * lerpFactor;
    this.updateCameraRotation();

    // Calculate movement direction based on camera orientation (including pitch)
    const forward = this.node.getDirection(Vector3.Forward()).normalize();
    const right = this.node.getDirection(Vector3.Right()).normalize();

    const moveVector = Vector3.Zero();

    // WASD movement (using keycodes like MovementController)
    if (this.pressedKeys.has("KeyW")) {
      moveVector.subtractInPlace(forward);
    }
    if (this.pressedKeys.has("KeyS")) {
      moveVector.addInPlace(forward);
    }
    if (this.pressedKeys.has("KeyA")) {
      moveVector.subtractInPlace(right);
    }
    if (this.pressedKeys.has("KeyD")) {
      moveVector.addInPlace(right);
    }

    // Space (up) and Shift (down) for vertical movement
    if (this.pressedKeys.has("Space")) {
      moveVector.y += 1;
    }
    if (this.pressedKeys.has("ShiftLeft") || this.pressedKeys.has("ShiftRight")) {
      moveVector.y -= 1;
    }

    // Apply movement
    if (moveVector.lengthSquared() > 0) {
      moveVector.normalize();
      const movement = moveVector.scale(this.moveSpeed * deltaTime / 1000);
      this.node.position.addInPlace(movement);
    }
  }

  private updateCameraRotation(): void {
    this.node.rotation.x = this.pitch;
    this.node.rotation.y = this.yaw;
    this.node.rotation.z = 0;
  }

  protected onDetach(): void {
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
      this.pointerObserver = null;
    }

    if (this.beforeRenderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.beforeRenderObserver);
      this.beforeRenderObserver = null;
    }

    if (InputModeManager.instance) {
      InputModeManager.instance.unregisterActionsForBehavior(this.name);
    }
  }
}
