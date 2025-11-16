import {
  Observer,
  PointerEventTypes,
  PointerInfo,
  Quaternion,
  TransformNode,
  UniversalCamera,
  Vector3,
} from "@babylonjs/core";
import { z } from "zod";

import { BaseBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { MovementController } from "../movement/MovementController";
import { InputModeManager, InputMode } from "../general/InputModeManager";

export class ThirdPersonCamera extends BaseBehavior<UniversalCamera> {
  public name = "ThirdPersonCamera";
  public static argsSchema = z.object({
    mouseSensitivity: z.number().positive().default(2).describe("Mouse sensitivity for camera movement, higher value is more sensitive"),
    pivotEntityId: z.string().describe("Entity ID of the holdables pivot that should rotate with camera pitch. Used for aiming holdable items like weapons.")
  }).describe(JSON.stringify({
    summary: "An over-the-shoulder third-person camera with smooth mouse look controls. Automatically calculates camera positioning based on initial offset from the character and features pitch clamping to prevent over-rotation. Communicates rotation changes to MovementController for character orientation and optionally controls gun rotation if a gun entity is specified. Only processes input during GAMEPLAY mode with pointer lock active.",
    whenToAttach: "Is part of `ThirdPersonPlayer` prefab, should not be attached to an entity manually. Use the prefab for third-person character setups.",
    requirementsToAttach: "Must be attached to a `standard/UniversalCamera` entity that is a child of a `TransformNode` with a `MovementController` behavior. Requires InputModeManager for input mode detection.",
    howToEdit: "Edit the file directly."
  } satisfies BehaviorMetadata));

  private pointerObserver: Observer<PointerInfo> | null = null;

  private readonly pitchLimitMin: number = -0.8;
  private readonly pitchLimitMax: number = 0.8;

  private mouseSensitivity: number;
  private behindOffset!: number;
  private aboveOffset!: number;
  private sideOffset!: number;
  private yaw!: number;
  private pitch!: number;

  private movementController: MovementController | null = null;

  private pivotEntityId: string;
  private pivotEntity!: TransformNode;

  // Check if device is mobile
  private get isMobile(): boolean {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  constructor(args: unknown) {
    super();
    const validatedArgs = ThirdPersonCamera.argsSchema.parse(args);
    this.mouseSensitivity = validatedArgs.mouseSensitivity;
    this.pivotEntityId = validatedArgs.pivotEntityId;
  }

  protected onAwake(): void {
    if (!this.node.parent) {
      throw new Error("ThirdPersonCamera requires a parent entity");
    }

    // Calculate offsets from initial camera position for over-the-shoulder view
    const initialPosition = this.node.position.clone();
    this.behindOffset = initialPosition.z; // Distance behind character
    this.aboveOffset = initialPosition.y; // Height above character
    this.sideOffset = initialPosition.x; // Left/right shoulder offset

    // Initialize yaw & pitch from parent character rotation
    this.yaw = (this.node.parent as TransformNode).rotation.y;
    this.pitch = this.node.rotation.x;

    // Find MovementController
    this.movementController = this.node.parent?.behaviors?.find(
      behavior => behavior instanceof MovementController
    ) as MovementController;

    // Find holdables pivot
    this.pivotEntity = this.scene.getNodeByName(this.pivotEntityId) as TransformNode;
    if (!this.pivotEntity) {
      throw new Error(`Holdables pivot entity with ID ${this.pivotEntityId} not found`);
    }
  }

  protected onStart(): void {
    this.updateCamera();
    this.updateMovementController();

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

        if (this.pitch < this.pitchLimitMin) this.pitch = this.pitchLimitMin;
        if (this.pitch > this.pitchLimitMax) this.pitch = this.pitchLimitMax;

        this.updateCamera();
        this.updateMovementController();
        this.updateHoldablesPivot();
      }
    }, PointerEventTypes.POINTERMOVE);
  }

  private updateCamera(): void {
    // Update camera position and rotation for over-the-shoulder view
    const cameraRotation = Quaternion.FromEulerAngles(this.pitch, 0, 0);
    const backwardDirection = Vector3.Forward().applyRotationQuaternion(cameraRotation);
    const rightDirection = Vector3.Cross(backwardDirection, Vector3.Up()).normalize();

    // Calculate camera offset: behind + height + shoulder
    const cameraOffset = backwardDirection.scale(this.behindOffset).add(rightDirection.scale(this.sideOffset));
    cameraOffset.y += this.aboveOffset;

    this.node.position.copyFrom(cameraOffset);
    this.node.rotation.x = this.pitch;
    this.node.rotation.y = 0;
    this.node.rotation.z = 0;
  }

  private updateMovementController(): void {
    if (!this.movementController) {
      return;
    }
    this.movementController.setCharacterOrientation(Quaternion.FromEulerAngles(0, this.yaw, 0));
  }

  private updateHoldablesPivot(): void {
    // Set the X rotation to match the camera's pitch
    this.pivotEntity.rotation.x = this.pitch;
  }

  protected onDetach(): void {
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
      this.pointerObserver = null;
    }
  }
}
