import { TransformNode, Vector3 } from "@babylonjs/core";
import { z } from "zod";

import { BaseBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";

export abstract class InteractableEntity extends BaseBehavior<TransformNode> {
  public name = "InteractableEntity";
  public static argsSchema = z.object({
    uiOffsetX: z.number().default(0).describe("X offset in world units for the interaction UI position"),
    uiOffsetY: z.number().default(0).describe("Y offset in world units for the interaction UI position"),
    uiOffsetZ: z.number().default(0).describe("Z offset in world units for the interaction UI position"),
    displayName: z.string().describe("The name to display below the interaction button")
  }).describe(JSON.stringify({
    summary: "Abstract base class for entities that can be interacted with by the player. Provides UI offset configuration and display name for world-space interaction indicators displayed by InteractionManager.",
    whenToAttach: "Do not attach directly. Extend this class to create custom interactable behaviors.",
    requirementsToAttach: "InteractionManager must be present on the `_managers` entity for interaction detection and UI display.",
    howToEdit: "Edit the file directly to modify the base class, or extend it to create new interactable types."
  } satisfies BehaviorMetadata));

  public uiOffset: Vector3;
  public displayName: string;

  constructor(args: unknown) {
    super();
    const validatedArgs = InteractableEntity.argsSchema.parse(args);
    this.uiOffset = new Vector3(validatedArgs.uiOffsetX, validatedArgs.uiOffsetY, validatedArgs.uiOffsetZ);
    this.displayName = validatedArgs.displayName;
  }

  protected onAwake(): void {}

  protected onStart(): void {}

  protected onDetach(): void {}

	public abstract onInteract(): void;
}
