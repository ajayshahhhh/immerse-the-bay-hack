import { z } from "zod";
import { type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { InteractableEntity } from "./InteractableEntity";
import { FlagsManager } from "../general/FlagsManager";

export class CollectibleKey extends InteractableEntity {
  public name = "CollectibleKey";
  public static argsSchema = InteractableEntity.argsSchema.extend({
    keyId: z.string().describe("Unique identifier for this key")
  }).describe(JSON.stringify({
    summary: "A collectible key that can be picked up by the player and tracked in the game.",
    whenToAttach: "Attach to key entities that should be collectible.",
    requirementsToAttach: "InteractionManager and FlagsManager must be present on the `_managers` entity.",
    howToEdit: "Edit the file directly."
  } satisfies BehaviorMetadata));

  private keyId: string;
  private flagsManager: FlagsManager | null = null;

  constructor(args: unknown) {
    super(args);
    const validatedArgs = CollectibleKey.argsSchema.parse(args);
    this.keyId = validatedArgs.keyId;
  }

  protected onAwake(): void {
    super.onAwake();
    
    // Get FlagsManager
    const managersNode = this.scene.getTransformNodeByName("_managers");
    if (managersNode) {
      this.flagsManager = managersNode.behaviors.find(b => b instanceof FlagsManager) as FlagsManager;
    }
  }

  public onInteract(): void {
    if (!this.flagsManager) {
      console.error("FlagsManager not found");
      return;
    }

    // Mark this key as collected
    this.flagsManager.setFlag(this.keyId, true);

    // Hide the key (make it disappear)
    this.node.setEnabled(false);

    // Check how many keys have been collected
    const key1 = this.flagsManager.getFlag("golden_key_1");
    const key2 = this.flagsManager.getFlag("golden_key_2");
    const key3 = this.flagsManager.getFlag("golden_key_3");
    
    const keysCollected = (key1 ? 1 : 0) + (key2 ? 1 : 0) + (key3 ? 1 : 0);
    
    console.log(`Collected ${this.keyId}. Total keys: ${keysCollected}/3`);
  }
}
