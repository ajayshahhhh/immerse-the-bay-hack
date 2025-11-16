import { TransformNode } from "@babylonjs/core";
import { BaseSingletonBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { z } from "zod";
import { DialogueUI } from "./DialogueUI";
import { EffectsAndConditionalsManager, type Effect, type Conditional } from "../general/EffectsAndConditionalsManager";

export interface DialogueCharacter {
	id: string;
	name: string;
}

interface BaseDialogueNode {
	id: number;
	nodeType: 'NPC' | 'PLAYER' | 'OUTCOME' | 'BRANCH';
}

export interface DialogueNPCNode extends BaseDialogueNode {
	nodeType: 'NPC';
	characterId: string;
	text: string;
	childrenIds: number[];
}

export interface DialoguePlayerNode extends BaseDialogueNode {
	nodeType: 'PLAYER';
	characterId: string;
	text: string;
	conditionals: Conditional[];
	conditionalText: string;
	childrenIds: number[];
}

export interface DialogueOutcomeNode extends BaseDialogueNode {
	nodeType: 'OUTCOME';
	effects: Effect[];
}

export interface DialogueBranchNode extends BaseDialogueNode {
	nodeType: 'BRANCH';
	branches: Array<{
		conditionals: Conditional[];
		childId: number;
	}>;
}

export type DialogueNode = DialogueNPCNode | DialoguePlayerNode | DialogueOutcomeNode | DialogueBranchNode;

class DialogueTree {
  public nodes: Map<number, DialogueNode> = new Map();

  public getChildNodes(nodeId: number): DialogueNode[] {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return [];
    }

    if (node.nodeType === 'OUTCOME') {
      return [];
    }

    if (node.nodeType === 'BRANCH') {
      return node.branches
        .map(branch => this.nodes.get(branch.childId))
        .filter(node => node !== undefined) as DialogueNode[];
    }

    return node.childrenIds.map(id => this.nodes.get(id)).filter(node => node !== undefined) as DialogueNode[];
  }
}

export class DialogueManager extends BaseSingletonBehavior<TransformNode> {
  public name = "DialogueManager";
  public static argsSchema = z.object({}).describe(JSON.stringify({
    summary: "A comprehensive dialogue system with tree-based conversation flow, multiple choice support, and full UI integration. Features character management, dialogue node traversal, keyboard navigation for choices, and automatic input mode switching. Includes a built-in sample dialogue tree with a Mysterious Merchant character. Handles dialogue text display, choice highlighting, and seamless transitions between dialogue and gameplay modes.",
    whenToAttach: "Must be used when any dialogue functionality is desired in the game. Required if there are any entities with `InteractableNPC` behavior that need to trigger conversations.",
    requirementsToAttach: "Must be placed on the `_managers` entity. Requires InputModeManager to be attached first for proper input mode switching and key handling.",
    howToEdit: "To edit dialogue data, edit `dialogue.json`. To edit functionality of how dialogue is processed, edit `DialogueManager.ts`. To edit the UI, edit `DialogueUI.ts`."
  } satisfies BehaviorMetadata));

  public static instance: DialogueManager | null = null;

  private uiClass: DialogueUI | null = null;

  private characters: Map<string, DialogueCharacter> = new Map();
  private trees: Map<string, DialogueTree> = new Map();

  private currentTree: DialogueTree | null = null;
  private currentNodeId: number | null = null;
  private selectedChoiceIndex: number = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public loadData(args: Record<string, any>) {
    // Load characters
    this.characters.clear();
    for (const [characterId, characterData] of Object.entries(args.characters)) {
      const charData = characterData as { name: string };
      this.characters.set(characterId, {
        id: characterId,
        name: charData.name
      });
    }

    // Load trees
    this.trees.clear();
    for (const [treeKey, treeData] of Object.entries(args.trees)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = treeData as { nodes: Record<string, any> };
      const tree = new DialogueTree();

      // Load all nodes into unified structure
      for (const [idStr, nodeData] of Object.entries(data.nodes)) {
        const id = parseInt(idStr);
        let node: DialogueNode;

        if (nodeData.nodeType === 'NPC') {
          node = {
            id,
            ...nodeData
          } as DialogueNPCNode;
        } else if (nodeData.nodeType === 'PLAYER') {
          node = {
            id,
            ...nodeData
          } as DialoguePlayerNode;
        } else if (nodeData.nodeType === 'OUTCOME') {
          node = {
            id,
            ...nodeData
          } as DialogueOutcomeNode;
        } else if (nodeData.nodeType === 'BRANCH') {
          node = {
            id,
            ...nodeData
          } as DialogueBranchNode;
        } else {
          throw new Error(`Unknown node type: ${nodeData.nodeType}`);
        }

        tree.nodes.set(id, node);
      }

      this.trees.set(treeKey, tree);
    }
  }

  protected onAwake(): void {
    this.uiClass = new DialogueUI();
    this.uiClass.setCallbacks(
      () => this.advanceDialogue(),
      (direction: number) => this.changeSelectedChoice(direction)
    );
    this.uiClass.initialize();
  }

  protected onStart(): void {}

  private advanceDialogue(): void {
    if (!EffectsAndConditionalsManager.instance) {
      throw new Error("EffectsAndConditionalsManager instance not found");
    }
    if (this.currentTree === null || this.currentNodeId === null) {
      throw new Error("advanceDialogue called when no dialogue is active");
    }
    if (!this.uiClass) {
      throw new Error("DialogueUI instance not found during dialogue end");
    }

    const currentNode = this.currentTree.nodes.get(this.currentNodeId);
    if (!currentNode) {
      throw new Error(`Dialogue node with ID ${this.currentNodeId} not found in current tree`);
    }

    const nodes = this.currentTree.getChildNodes(this.currentNodeId);

    if (nodes.length === 0) {
      // End of dialogue with no nodes - hide it
      this.currentNodeId = null;
      this.uiClass.hideDialogue();
      return;
    } else if (currentNode.nodeType === 'NPC' && nodes.every(node => node.nodeType === 'PLAYER')) {
      // Select the highlighted player choice (must be selectable)
      const selectedNode = nodes[this.selectedChoiceIndex];
      if (selectedNode && this.isNodeSelectable(selectedNode)) {
        this.currentNodeId = selectedNode.id;
      } else {
        // Selected choice is not selectable, should not happen with proper navigation
        throw new Error("Attempted to select an unselectable dialogue choice");
      }
      this.selectedChoiceIndex = 0;
    } else {
      // Continue to next node
      this.currentNodeId = nodes[0]?.id || null;
    }

    // Process BRANCH and OUTCOME nodes
    this.processAutomaticNodes();

    // Update display if dialogue is still active
    if (this.currentNodeId !== null) {
      this.updateDialogueDisplay();
    }
  }

  private changeSelectedChoice(direction: number): void {
    if (this.currentTree === null || this.currentNodeId === null) {
      throw new Error("changeSelectedChoice called when no dialogue is active");
    }

    const currentNode = this.currentTree.nodes.get(this.currentNodeId);
    if (!currentNode) {
      throw new Error(`Dialogue node with ID ${this.currentNodeId} not found in current tree`);
    }

    const nodes = this.currentTree.getChildNodes(this.currentNodeId);

    // Only allow navigation if we're at NPC node with multiple player choices
    if (nodes.length > 1 && currentNode.nodeType === 'NPC' &&
			nodes.every(node => node.nodeType === 'PLAYER')) {

      const selectableIndices = nodes
        .map((node, index) => this.isNodeSelectable(node) ? index : -1)
        .filter(index => index !== -1);

      if (selectableIndices.length > 1) {
        const currentSelectableIndex = selectableIndices.findIndex(index => index === this.selectedChoiceIndex);
        const nextSelectableIndex = (currentSelectableIndex + direction + selectableIndices.length) % selectableIndices.length;
        this.selectedChoiceIndex = selectableIndices[nextSelectableIndex];
        this.updateDialogueDisplay();
      }
    }
  }

  private updateDialogueDisplay(): void {
    if (this.currentTree === null || this.currentNodeId === null) {
      throw new Error("updateDialogueDisplay called when no dialogue is active");
    }
    if (!this.uiClass) {
      throw new Error("DialogueUI instance not found during display update");
    }

    const currentNode = this.currentTree.nodes.get(this.currentNodeId);
    if (!currentNode) {
      throw new Error(`Dialogue node with ID ${this.currentNodeId} not found in current tree`);
    }
    if (currentNode.nodeType === 'OUTCOME') {
      throw new Error("updateDialogueDisplay should not be called for outcome nodes");
    }
    if (currentNode.nodeType === 'BRANCH') {
      throw new Error("updateDialogueDisplay should not be called for branch nodes");
    }

    const character = this.characters.get(currentNode.characterId);
    if (!character) {
      throw new Error(`Dialogue node with character ${currentNode.characterId} not found in current node`);
    }

    const nodes = this.currentTree.getChildNodes(this.currentNodeId);
    const selectableNodes = nodes.map(node => this.isNodeSelectable(node));

    // Ensure selectedChoiceIndex points to a selectable node for player choices
    if (nodes.length > 0 && nodes.every(node => node.nodeType === 'PLAYER') && !selectableNodes[this.selectedChoiceIndex]) {
      this.selectedChoiceIndex = this.findFirstSelectableIndex(nodes);
    }

    this.uiClass.updateDisplay(currentNode, nodes, character, this.selectedChoiceIndex, selectableNodes);
  }

  private isNodeSelectable(node: DialogueNode): boolean {
    if (!EffectsAndConditionalsManager.instance) {
      throw new Error("EffectsAndConditionalsManager instance not found");
    }

    // Non-player nodes are always selectable
    if (node.nodeType !== 'PLAYER') {
      return true;
    }

    // Evaluate all conditionals for selectability (all must be true)
    return EffectsAndConditionalsManager.instance.evaluateConditionals((node as DialoguePlayerNode).conditionals);
  }

  private evaluateBranch(branchNode: DialogueBranchNode): number | null {
    if (!EffectsAndConditionalsManager.instance) {
      throw new Error("EffectsAndConditionalsManager instance not found");
    }

    // Iterate through branches in order, return first matching branch
    for (const branch of branchNode.branches) {
      const conditionsMet = EffectsAndConditionalsManager.instance.evaluateConditionals(branch.conditionals);
      if (conditionsMet) {
        return branch.childId;
      }
    }

    // No branch matched
    return null;
  }

  private processAutomaticNodes(): void {
    if (!EffectsAndConditionalsManager.instance) {
      throw new Error("EffectsAndConditionalsManager instance not found");
    }
    if (!this.uiClass) {
      throw new Error("DialogueUI instance not found");
    }
    if (this.currentTree === null) {
      throw new Error("processAutomaticNodes called when no tree is active");
    }

    // Process BRANCH and OUTCOME nodes until we reach a displayable node
    while (this.currentNodeId !== null) {
      const currentNode = this.currentTree.nodes.get(this.currentNodeId);
      if (!currentNode) {
        this.currentNodeId = null;
        return;
      }

      if (currentNode.nodeType === 'OUTCOME') {
        // Execute effects and end dialogue
        EffectsAndConditionalsManager.instance.executeEffects(currentNode.effects);
        this.currentNodeId = null;
        this.uiClass.hideDialogue();
        return;
      }

      if (currentNode.nodeType === 'BRANCH') {
        // Evaluate branch and continue to selected child
        const selectedChildId = this.evaluateBranch(currentNode);
        if (selectedChildId === null) {
          throw new Error(`No valid branch found for BRANCH node ${currentNode.id}`);
        }
        this.currentNodeId = selectedChildId;
        continue;
      }

      // Reached NPC or PLAYER node - stop processing
      break;
    }
  }

  private findFirstSelectableIndex(nodes: DialogueNode[]): number {
    const selectableIndices = nodes
      .map((node, index) => this.isNodeSelectable(node) ? index : -1)
      .filter(index => index !== -1);
    return selectableIndices.length > 0 ? selectableIndices[0] : 0;
  }

  protected onDetach(): void {
    if (this.uiClass) {
      this.uiClass.dispose();
      this.uiClass = null;
    }
    this.trees.clear();
    this.characters.clear();
  }

  public switchToTree(treeKey: string): void {
    const tree = this.trees.get(treeKey);
    if (!tree) {
      throw new Error(`Dialogue tree '${treeKey}' not found`);
    }
    if (!this.uiClass) {
      throw new Error("DialogueUI instance not found during tree switch");
    }

    this.currentTree = tree;
    this.currentNodeId = 0;
    this.selectedChoiceIndex = 0;

    // Process BRANCH and OUTCOME nodes
    this.processAutomaticNodes();

    // Only show dialogue if we reached a displayable node
    if (this.currentNodeId !== null) {
      this.updateDialogueDisplay();
      this.uiClass.showDialogue();
    }
  }
}
