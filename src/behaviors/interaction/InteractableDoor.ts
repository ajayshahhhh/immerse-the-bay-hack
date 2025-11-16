import { z } from "zod";
import { type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { InteractableEntity } from "./InteractableEntity";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { FlagsManager } from "../general/FlagsManager";

export class InteractableDoor extends InteractableEntity {
  public name = "InteractableDoor";
  public static argsSchema = InteractableEntity.argsSchema.extend({
    message: z.string().describe("The message to display when interacting with the door"),
    messageDuration: z.number().default(3000).describe("How long to display the message in milliseconds"),
    requiredKeys: z.array(z.string()).default(["golden_key_1", "golden_key_2", "golden_key_3"]).describe("Keys required to unlock the door")
  }).describe(JSON.stringify({
    summary: "An interactable door that displays a message when the player presses E nearby.",
    whenToAttach: "Attach to door entities that should show interaction prompts and messages.",
    requirementsToAttach: "InteractionManager and FlagsManager must be present on the `_managers` entity.",
    howToEdit: "Edit the file directly."
  } satisfies BehaviorMetadata));

  private message: string;
  private messageDuration: number;
  private requiredKeys: string[];
  private guiTexture: AdvancedDynamicTexture | null = null;
  private messageText: TextBlock | null = null;
  private flagsManager: FlagsManager | null = null;

  constructor(args: unknown) {
    super(args);
    const validatedArgs = InteractableDoor.argsSchema.parse(args);
    this.message = validatedArgs.message;
    this.messageDuration = validatedArgs.messageDuration;
    this.requiredKeys = validatedArgs.requiredKeys;
  }

  protected onAwake(): void {
    super.onAwake();
    
    // Get FlagsManager
    const managersNode = this.scene.getTransformNodeByName("_managers");
    if (managersNode) {
      this.flagsManager = managersNode.behaviors.find(b => b instanceof FlagsManager) as FlagsManager;
    }
    
    // Create GUI texture for displaying messages
    this.guiTexture = AdvancedDynamicTexture.CreateFullscreenUI("DoorMessageUI", true, this.scene);
    
    // Create text block for message
    this.messageText = new TextBlock();
    this.messageText.text = "";
    this.messageText.color = "white";
    this.messageText.fontSize = 32;
    this.messageText.fontWeight = "bold";
    this.messageText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.messageText.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    this.messageText.top = "100px"; // Position slightly below center
    this.messageText.outlineWidth = 2;
    this.messageText.outlineColor = "black";
    this.messageText.isVisible = false;
    
    this.guiTexture.addControl(this.messageText);
  }

  private hasAllKeys(): boolean {
    if (!this.flagsManager) return false;
    
    for (const keyId of this.requiredKeys) {
      if (!this.flagsManager.getFlag(keyId)) {
        return false;
      }
    }
    return true;
  }

  public onInteract(): void {
    if (!this.messageText) return;
    
    // Check if player has all keys
    if (this.hasAllKeys()) {
      // Player wins!
      this.messageText.text = "You Win!";
      this.messageText.fontSize = 64;
      this.messageText.isVisible = true;
      
      // Stop the game by disabling player controls
      const playerNode = this.scene.getTransformNodeByName("player");
      if (playerNode) {
        playerNode.setEnabled(false);
      }
      
      // Don't hide the message
    } else {
      // Display the locked message
      this.messageText.text = this.message;
      this.messageText.fontSize = 32;
      this.messageText.isVisible = true;
      
      // Hide the message after the duration
      setTimeout(() => {
        if (this.messageText) {
          this.messageText.isVisible = false;
        }
      }, this.messageDuration);
    }
  }

  protected onDetach(): void {
    super.onDetach();
    
    // Clean up GUI
    if (this.guiTexture) {
      this.guiTexture.dispose();
      this.guiTexture = null;
    }
    this.messageText = null;
  }
}
