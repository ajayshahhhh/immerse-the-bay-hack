import {
  ActionManager,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  Observer,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { z } from "zod";

import { BaseSingletonBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { InteractableEntity } from "./InteractableEntity";
import { InputModeManager, InputMode } from "../general/InputModeManager";

export class InteractionManager extends BaseSingletonBehavior<TransformNode> {
  public name = "InteractionManager";
  public static argsSchema = z.object({
    playerEntityId: z.string().describe("The entity ID of the player character to use for proximity and direction-based interaction detection.")
  }).describe(JSON.stringify({
    summary: "A proximity-based interaction system that detects nearby interactable entities and manages interaction UI. Automatically scans for entities with InteractableEntity behaviors within a fixed range of the specified player entity, considering both distance and direction. Displays an interaction indicator above the closest interactable object and handles E key press interactions. Features dynamic UI positioning that follows 3D objects and only operates in GAMEPLAY input mode.",
    whenToAttach: "Must be used when any interaction functionality is desired in the game. Required if there are any entities with `InteractableEntity` derived behaviors, including `InteractableNPC`.",
    requirementsToAttach: "Must be placed on the `_managers` entity. Requires InputModeManager to be attached first for input handling and mode detection. The specified playerEntityId must exist in the scene.",
    howToEdit: "Edit the file directly."
  } satisfies BehaviorMetadata));

  private beforeRenderObserver: Observer<Scene> | null = null;

  public static instance: InteractionManager | null = null;

  private readonly INTERACTION_DISTANCE = 5;
  private readonly INTERACTION_DIRECTION = 0.25;

  private playerEntityId: string;
  private playerEntity!: TransformNode;
  private currentInteractable: InteractableEntity | null = null;
  private interactionUIContainer: TransformNode | null = null;
  private nameTextPlane: Mesh | null = null;

  constructor(args: unknown) {
    super();
    const validatedArgs = InteractionManager.argsSchema.parse(args);
    this.playerEntityId = validatedArgs.playerEntityId;
  }

  public loadData(): void {}

  protected onAwake(): void {}

  protected onStart(): void {
    if (!InputModeManager.instance) {
      throw new Error("InputModeManager instance not found");
    }

    // Register E key for interaction in gameplay mode
    InputModeManager.instance.registerAction(
      InputMode.GAMEPLAY,
      ActionManager.OnKeyDownTrigger,
      (evt) => {
        if (evt.sourceEvent.code === "KeyE") {
          this.handleInteraction();
        }
      },
      this.name
    );

    // Find player entity
    this.playerEntity = this.scene.getNodeByName(this.playerEntityId) as TransformNode;
    if (!this.playerEntity) {
      throw new Error(`Player entity with ID ${this.playerEntityId} not found`);
    }

    // Create the interaction UI
    this.createInteractionUI();

    // Set up update loop
    this.beforeRenderObserver = this.scene.onBeforeRenderObservable.add(() => {
      this.checkForInteractables();
    });
  }

  protected onDetach(): void {
    if (this.beforeRenderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.beforeRenderObserver);
      this.beforeRenderObserver = null;
    }
    if (InputModeManager.instance) {
      InputModeManager.instance.unregisterActionsForBehavior(this.name);
    }

    if (this.interactionUIContainer) {
      this.interactionUIContainer.dispose();
    }
  }

  private createInteractionUI(): void {
    // Create parent container
    this.interactionUIContainer = new TransformNode("interactionUIContainer", this.scene);

    // Create E button plane
    const iconPlane = MeshBuilder.CreatePlane("interactionIconPlane", {
      size: 0.2
    }, this.scene);
    iconPlane.parent = this.interactionUIContainer;
    iconPlane.position = new Vector3(0, 0.2, 0);
    iconPlane.renderingGroupId = 2;
    iconPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;

    // Create material with transparency for E button
    const iconMaterial = new StandardMaterial("interactionIconMaterial", this.scene);
    iconMaterial.disableLighting = true;
    iconMaterial.emissiveTexture = new Texture("https://spatio-generations.s3.amazonaws.com/ui/e_paper.png", this.scene);
    iconMaterial.emissiveTexture.hasAlpha = true;
    iconMaterial.diffuseTexture = iconMaterial.emissiveTexture;
    iconMaterial.useAlphaFromDiffuseTexture = true;
    iconMaterial.backFaceCulling = false;
    iconPlane.material = iconMaterial;

    // Create name text plane
    this.nameTextPlane = MeshBuilder.CreatePlane("nameTextPlane", {
      width: 1.0,
      height: 0.2
    }, this.scene);
    this.nameTextPlane.parent = this.interactionUIContainer;
    this.nameTextPlane.position = new Vector3(0, 0, 0);
    this.nameTextPlane.renderingGroupId = 2;
    this.nameTextPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;

    // Disable by default
    this.interactionUIContainer.setEnabled(false);
  }

  private updateNameText(name: string): void {
    if (!this.nameTextPlane) return;

    // Create dynamic texture for text rendering
    const dynamicTexture = new DynamicTexture(
      "nameTextTexture",
      { width: 1000, height: 200 },
      this.scene
    );

    // Draw text
    dynamicTexture.drawText(
      name,
      null,
      null,
      "bold 120px Arial",
      "white",
      null,
      true,
      true
    );

    // Create material with the dynamic texture
    const material = new StandardMaterial("nameTextMaterial", this.scene);
    material.diffuseTexture = dynamicTexture;
    material.diffuseTexture.hasAlpha = true;
    material.useAlphaFromDiffuseTexture = true;
    material.backFaceCulling = false;

    // Dispose old material if it exists
    if (this.nameTextPlane.material) {
      this.nameTextPlane.material.dispose();
    }

    this.nameTextPlane.material = material;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private findEntitiesWithBehavior<T>(behaviorClass: new (...args: any[]) => T): Array<{ entity: any, behavior: T }> {
    // Get all behavior-aware entities (nodes, meshes, lights, cameras)
    const allEntities = [
      ...this.scene.transformNodes,
      ...this.scene.meshes
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: Array<{ entity: any, behavior: T }> = [];

    for (const entity of allEntities) {
      // Skip if entity doesn't have behaviors property
      if (!entity.behaviors) continue;

      // Check if this entity has the specified behavior attached
      const behavior = entity.behaviors.find(b => b instanceof behaviorClass);
      if (behavior) {
        results.push({ entity, behavior: behavior as T });
      }
    }

    return results;
  }

  private checkForInteractables(): void {
    if (!InputModeManager.instance) {
      throw new Error("InputModeManager instance not found");
    }

    // Only check for interactables in GAMEPLAY mode
    if (InputModeManager.instance.getCurrentMode() !== InputMode.GAMEPLAY) {
      this.updateCurrentInteractable(null);
      return;
    }

    let closestInteractable: InteractableEntity | null = null;
    let closestDistance = Infinity;

    // Find all entities with InteractableEntity behavior
    // @ts-expect-error: look into how to check abstract classes in this way
    const interactableEntities = this.findEntitiesWithBehavior(InteractableEntity);

    const playerPosition = this.playerEntity.getAbsolutePosition();
    for (const { entity, behavior } of interactableEntities) {
      const entityPosition = entity.getAbsolutePosition();
      const distance = Vector3.Distance(playerPosition, entityPosition);

      // Skip if too far
      if (distance > this.INTERACTION_DISTANCE) {
        continue;
      }

      // Check if the interactable is roughly in front of the player
      const directionToEntity = entityPosition.subtract(playerPosition).normalize();
      const dotProduct = Vector3.Dot(this.playerEntity.forward, directionToEntity);
      if (dotProduct < this.INTERACTION_DIRECTION) {
        continue;
      }

      // Track closest interactable within range and direction
      if (distance < closestDistance) {
        closestDistance = distance;
        closestInteractable = behavior;
      }
    }

    // Update current interactable and indicator
    this.updateCurrentInteractable(closestInteractable);
  }

  private handleInteraction(): void {
    if (!InputModeManager.instance) {
      throw new Error("InputModeManager instance not found");
    }

    // Only allow interactions in GAMEPLAY mode
    if (InputModeManager.instance.getCurrentMode() !== InputMode.GAMEPLAY) {
      return;
    }

    if (this.currentInteractable) {
      this.currentInteractable.onInteract();
    }
  }

  private updateCurrentInteractable(newInteractable: InteractableEntity | null): void {
    if (this.currentInteractable === newInteractable) return;

    this.currentInteractable = newInteractable;

    if (!this.interactionUIContainer) return;

    if (this.currentInteractable) {
      // Position container in world space at interactable position + uiOffset
      // @ts-expect-error: look into how to access the node property
      const interactablePosition = this.currentInteractable.node.getAbsolutePosition();
      this.interactionUIContainer.position.copyFrom(interactablePosition.add(this.currentInteractable.uiOffset));

      // Update the name text
      this.updateNameText(this.currentInteractable.displayName);

      this.interactionUIContainer.setEnabled(true);
    } else {
      // Hide UI
      this.interactionUIContainer.setEnabled(false);
    }
  }
}
