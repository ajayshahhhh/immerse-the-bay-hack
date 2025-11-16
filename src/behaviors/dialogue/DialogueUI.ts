import { ActionManager } from "@babylonjs/core";
import { AdvancedDynamicTexture, TextBlock, Control, Rectangle } from "@babylonjs/gui";
import { InputModeManager, InputMode } from "../general/InputModeManager";
import { type DialogueCharacter, type DialogueNode, type DialoguePlayerNode } from "./DialogueManager";

export class DialogueUI {
  public name = "DialogueUI";

  private advancedTexture: AdvancedDynamicTexture | null = null;
  private dialogueBox: Rectangle | null = null;
  private characterNameBlock: TextBlock | null = null;
  private dialogueTextBlock: TextBlock | null = null;
  private instructionsBlock: TextBlock | null = null;

  private onAdvanceCallback: (() => void) | null = null;
  private onChangeChoiceCallback: ((direction: number) => void) | null = null;

  constructor() {}

  public initialize(): void {
    this.setupUI();
    this.setupInputHandling();
    this.hideDialogue();
  }

  public dispose(): void {
    if (InputModeManager.instance) {
      InputModeManager.instance.unregisterActionsForBehavior(this.name);
    }
    this.disposeUI();
    this.onAdvanceCallback = null;
    this.onChangeChoiceCallback = null;
  }

  public setCallbacks(
    onAdvance: () => void,
    onChangeChoice: (direction: number) => void
  ): void {
    this.onAdvanceCallback = onAdvance;
    this.onChangeChoiceCallback = onChangeChoice;
  }

  private setupUI(): void {
    this.advancedTexture = AdvancedDynamicTexture.CreateFullscreenUI("DialogueUI");

    // Enable adaptive scaling for responsive design
    this.advancedTexture.idealWidth = 1920;
    this.advancedTexture.idealHeight = 1080;

    // Create the dialogue box background
    this.dialogueBox = new Rectangle();
    this.dialogueBox.width = "70%";
    this.dialogueBox.height = "250px";
    this.dialogueBox.background = "tan";
    this.dialogueBox.color = "white";
    this.dialogueBox.thickness = 0;
    this.dialogueBox.cornerRadius = 20;
    this.dialogueBox.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    this.dialogueBox.top = "-30px";

    // Create character name text (bigger, at top)
    this.characterNameBlock = new TextBlock();
    this.characterNameBlock.color = "brown";
    this.characterNameBlock.fontSize = 32;
    this.characterNameBlock.fontFamily = "Georgia";
    this.characterNameBlock.fontWeight = "bold";
    this.characterNameBlock.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.characterNameBlock.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.characterNameBlock.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.characterNameBlock.paddingLeft = "40px";
    this.characterNameBlock.paddingTop = "35px";
    this.characterNameBlock.height = "80px";

    // Create dialogue text (below character name)
    this.dialogueTextBlock = new TextBlock();
    this.dialogueTextBlock.color = "brown";
    this.dialogueTextBlock.fontSize = 24;
    this.dialogueTextBlock.fontFamily = "Arial";
    this.dialogueTextBlock.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.dialogueTextBlock.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.dialogueTextBlock.paddingLeft = "40px";
    this.dialogueTextBlock.paddingRight = "40px";
    this.dialogueTextBlock.paddingTop = "80px";
    this.dialogueTextBlock.paddingBottom = "40px";
    this.dialogueTextBlock.textWrapping = true;

    // Create instructions text (small, bottom right)
    this.instructionsBlock = new TextBlock();
    this.instructionsBlock.color = "rgba(101, 40, 40, 0.7)";
    this.instructionsBlock.fontSize = 18;
    this.instructionsBlock.fontFamily = "Arial";
    this.instructionsBlock.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    this.instructionsBlock.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    this.instructionsBlock.paddingRight = "20px";
    this.instructionsBlock.paddingBottom = "15px";

    // Add all text blocks to the dialogue box
    this.dialogueBox.addControl(this.characterNameBlock);
    this.dialogueBox.addControl(this.dialogueTextBlock);
    this.dialogueBox.addControl(this.instructionsBlock);

    // Add the dialogue box to the screen
    this.advancedTexture.addControl(this.dialogueBox);
  }

  private setupInputHandling(): void {
    if (!InputModeManager.instance) {
      throw new Error("InputModeManager instance not found");
    }

    InputModeManager.instance.registerAction(
      InputMode.DIALOGUE,
      ActionManager.OnKeyDownTrigger,
      (evt) => {
        if (evt.sourceEvent.code === "KeyE" || evt.sourceEvent.code === "Enter") {
          if (this.onAdvanceCallback) {
            this.onAdvanceCallback();
          }
        } else if (evt.sourceEvent.code === "ArrowUp" || evt.sourceEvent.code === "KeyW") {
          if (this.onChangeChoiceCallback) {
            this.onChangeChoiceCallback(-1);
          }
        } else if (evt.sourceEvent.code === "ArrowDown" || evt.sourceEvent.code === "KeyS") {
          if (this.onChangeChoiceCallback) {
            this.onChangeChoiceCallback(1);
          }
        }
      },
      this.name
    );
  }

  public updateDisplay(currentNode: DialogueNode | null, nodes: DialogueNode[], character: DialogueCharacter | null, selectedChoiceIndex: number, selectableNodes: boolean[]): void {
    if (!currentNode || !character || !this.characterNameBlock || !this.dialogueTextBlock || !this.instructionsBlock) {
      throw new Error("Current dialogue node and UI components are required");
    }
    if (currentNode.nodeType === 'OUTCOME' || currentNode.nodeType === 'BRANCH') {
      throw new Error(`updateDisplay should not be called for ${currentNode.nodeType} nodes`);
    }

    // Set character name
    this.characterNameBlock.text = character.name;

    let dialogueText = currentNode.text;
    let instructionText = "";

    // Show choices if NPC has player nodes
    if (currentNode.nodeType === 'NPC' && nodes.length > 0 && nodes.every(node => node.nodeType === 'PLAYER')) {
      dialogueText += "\n";
      nodes.forEach((choice, index) => {
        if (choice.nodeType === 'PLAYER') {
          const playerChoice = choice as DialoguePlayerNode;
          const isSelected = index === selectedChoiceIndex;
          const isSelectable = selectableNodes[index];

          let text = playerChoice.text;
          if (playerChoice.conditionalText) {
            text = `(${isSelectable ? "Satisfied" : "Required"}: ${playerChoice.conditionalText}) ${text}`;
          }

          dialogueText += `\n${isSelected ? "► " : "  "}${text}`;
        }
      });
      instructionText = "Use ↑↓ to navigate • Press E to continue";
    } else {
      instructionText = "Press E to continue";
    }

    this.dialogueTextBlock.text = dialogueText;
    this.instructionsBlock.text = instructionText;
  }

  public showDialogue(): void {
    if (!InputModeManager.instance) {
      throw new Error("InputModeManager instance not found");
    }
    if (!this.dialogueBox) {
      throw new Error("Dialogue box not initialized");
    }

    this.dialogueBox.isVisible = true;

    InputModeManager.instance.switchTo(InputMode.DIALOGUE);
  }

  public hideDialogue(): void {
    if (!InputModeManager.instance) {
      throw new Error("InputModeManager instance not found");
    }
    if (!this.dialogueBox) {
      throw new Error("Dialogue box not initialized");
    }

    this.dialogueBox.isVisible = false;

    InputModeManager.instance.switchTo(InputMode.GAMEPLAY);
  }

  private disposeUI(): void {
    this.hideDialogue();
    if (this.advancedTexture) {
      this.advancedTexture.dispose();
      this.advancedTexture = null;
    }
    this.dialogueBox = null;
    this.characterNameBlock = null;
    this.dialogueTextBlock = null;
    this.instructionsBlock = null;
  }
}
