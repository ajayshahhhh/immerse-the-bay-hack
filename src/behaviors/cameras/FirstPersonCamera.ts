import {
  Observer,
  PointerEventTypes,
  PointerInfo,
  Quaternion,
  TransformNode,
  UniversalCamera,
} from "@babylonjs/core";

import { BaseBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { z } from "zod";
import { MovementController } from "../movement/MovementController";
import { InputModeManager, InputMode } from "../general/InputModeManager";

export class FirstPersonCamera extends BaseBehavior<UniversalCamera> {
  public name = "FirstPersonCamera";
  public static argsSchema = z.object({
    mouseSensitivity: z.number().positive().default(2).describe("Mouse sensitivity for camera movement, higher value is more sensitive")
  }).describe(JSON.stringify({
    summary: "A first-person camera with smooth mouse look controls and pitch clamping. Handles camera rotation while communicating yaw changes to the parent MovementController for character orientation. Features automatic pitch limiting to prevent over-rotation and only processes input during GAMEPLAY mode with pointer lock active.",
    whenToAttach: "Is part of `FirstPersonPlayer` prefab, should not be attached to an entity manually. Use the prefab for first-person character setups.",
    requirementsToAttach: "Must be attached to a `standard/UniversalCamera` entity that is a child of a `TransformNode` with a `MovementController` behavior. Requires `InputModeManager` for input mode detection.",
    howToEdit: "Edit the file directly."
  } satisfies BehaviorMetadata));

  private pointerObserver: Observer<PointerInfo> | null = null;

  private mouseSensitivity: number;
  private yaw: number = 0;
  private pitch: number = 0;

  // Check if device is mobile
  private get isMobile(): boolean {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  constructor(args: unknown) {
    super();
    const validatedArgs = FirstPersonCamera.argsSchema.parse(args);
    this.mouseSensitivity = validatedArgs.mouseSensitivity;
  }

  protected onAwake(): void {
    if (!this.node.parent) {
      throw new Error("FirstPersonCamera requires a parent entity");
    }

    // Initialize yaw & pitch from parent character rotation
    this.yaw = (this.node.parent as TransformNode).rotation.y;
    this.pitch = this.node.rotation.x;
  }

  protected onStart(): void {
    this.updateCamera();

    // Mouse look
    this.pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
      const canvas = this.scene.getEngine().getRenderingCanvas();

      // On mobile, skip pointer lock check; on desktop, require pointer lock
      const hasPointerLock = this.isMobile || document.pointerLockElement === canvas;
      const canProcessInput = hasPointerLock && InputModeManager.instance?.getCurrentMode() === InputMode.GAMEPLAY;

      if (canProcessInput && pointerInfo.type === PointerEventTypes.POINTERMOVE) {
        const evt = pointerInfo.event as MouseEvent;
        this.yaw -= evt.movementX * this.mouseSensitivity / 1000;
        this.pitch -= evt.movementY * this.mouseSensitivity / 1000;

        // Clamp pitch between straight up and down
        const limit = Math.PI / 2 - 0.01;
        if (this.pitch > limit) this.pitch = limit;
        if (this.pitch < -limit) this.pitch = -limit;

        this.updateCamera();
      }
    }, PointerEventTypes.POINTERMOVE);
  }

  private updateCamera(): void {
    // Apply only pitch to camera
    this.node.rotation.x = this.pitch;
    this.node.rotation.y = 0;
    this.node.rotation.z = 0;

    // Update parent character orientation in MovementController if present
    const movementController = this.node.parent?.behaviors?.find(
      behavior => behavior instanceof MovementController
    ) as MovementController;
    if (movementController) {
      movementController.setCharacterOrientation(Quaternion.FromEulerAngles(0, this.yaw, 0));
    }
  }

  protected onDetach(): void {
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
      this.pointerObserver = null;
    }
  }
}
