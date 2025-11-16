import { InteractableEntity } from "./InteractableEntity";
import { DialogueManager } from "../dialogue/DialogueManager";
import { z } from "zod";
import type { BehaviorMetadata } from "@moonlakeai/game-sdk";

export class InteractableNPC extends InteractableEntity {
  public name = "InteractableNPC";
  public static argsSchema = z.object({
    uiOffsetX: z.number().default(0).describe("X offset in world units for the interaction UI position"),
    uiOffsetY: z.number().default(0).describe("Y offset in world units for the interaction UI position"),
    uiOffsetZ: z.number().default(0).describe("Z offset in world units for the interaction UI position"),
    displayName: z.string().describe("The name to display below the interaction button"),
    dialogueTreeKey: z.string().describe("The key of the dialogue tree in DialogueManager that should be activated when this NPC is interacted with. Must match a tree key that exists in the DialogueManager's storage.")
  }).describe(JSON.stringify({
    summary: "An interactable NPC that triggers specific dialogue trees when the player interacts with it. Extends InteractableEntity to provide proximity-based interaction detection and automatically switches to the specified dialogue tree in DialogueManager when activated. Works seamlessly with InteractionManager for range detection and UI display.",
    whenToAttach: "Attach to any NPC entity that should trigger conversations when the player approaches and presses the interaction key (E).",
    requirementsToAttach: "`DialogueManager` must exist on the `_managers` entity with the specified dialogue tree loaded. `InteractionManager` must also be present for interaction detection and UI display.",
    howToEdit: "Edit the file directly."
  } satisfies BehaviorMetadata));

  private dialogueTreeKey: string;

  constructor(args: unknown) {
    super(args);
    const validatedArgs = InteractableNPC.argsSchema.parse(args);
    this.dialogueTreeKey = validatedArgs.dialogueTreeKey;
  }

  protected onStart(): void {}

  public onInteract(): void {
    if (!DialogueManager.instance) {
      throw new Error("DialogueManager not found");
    }
    DialogueManager.instance.switchToTree(this.dialogueTreeKey);
  }
}
