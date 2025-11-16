import { TransformNode, Node } from "@babylonjs/core";
import { BaseBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { z } from "zod";
import { PrefabManager } from "../general/PrefabManager";
import { HoldableItem } from "./HoldableItem";
import { IKController } from "../animation/IKController";

export class HoldableSwitcher extends BaseBehavior<TransformNode> {
  public name = "HoldableSwitcher";
  public static argsSchema = z.object({
    holdablesContainerEntityId: z.string().describe("Entity ID of the container where holdable items should be instantiated as children"),
    meshEntityId: z.string().optional().describe("Optional entity ID of the character mesh that has the IKController for hand positioning. Required for third-person characters with IK. Not needed for first-person where no character mesh is visible.")
  }).describe(JSON.stringify({
    summary: "Manages dynamic switching between different holdable items by instantiating and destroying prefabs based on inventory selection. Optionally coordinates with IKController to position character hands on the currently held item (for third-person). Handles cleanup of previous items and seamless transitions between different tools, weapons, or objects that the character can hold.",
    whenToAttach: "Use on character entities that need to dynamically hold different items from inventory. Works for both first-person (without IK) and third-person (with IK) characters.",
    requirementsToAttach: "Requires PrefabManager for item instantiation. The specified holdables container entity must exist. If meshEntityId is provided, that mesh entity must have IKController and holdable prefabs must have HoldableItem behaviors with hand target positions.",
    howToEdit: "Edit the file directly. For third-person characters, provide meshEntityId. For first-person characters, omit meshEntityId."
  } satisfies BehaviorMetadata));

  private holdablesContainerEntityId: string;
  private holdablesContainerEntity!: TransformNode;

  private meshEntityId?: string;
  private iKController?: IKController;

  private currentItemId: string | null = null;
  private currentItem: Node | null = null;
  private currentItemHoldable: HoldableItem | null = null;

  constructor(args: unknown) {
    super();
    const validatedArgs = HoldableSwitcher.argsSchema.parse(args);
    this.holdablesContainerEntityId = validatedArgs.holdablesContainerEntityId;
    this.meshEntityId = validatedArgs.meshEntityId;
  }

  protected onAwake(): void {
    this.holdablesContainerEntity = this.scene.getNodeByName(this.holdablesContainerEntityId) as TransformNode;
    if (!this.holdablesContainerEntity) {
      throw new Error(`Holdables container ${this.holdablesContainerEntityId} not found`);
    }

    // Only set up IK if meshEntityId is provided (for third-person characters)
    if (this.meshEntityId) {
      const meshEntity = this.scene.getNodeByName(this.meshEntityId);
      if (!meshEntity) {
        throw new Error(`Mesh ${this.meshEntityId} not found`);
      }
      this.iKController = meshEntity.behaviors.find(behavior => behavior instanceof IKController) as IKController;
      if (!this.iKController) {
        throw new Error(`IKController not found on mesh ${this.meshEntityId}`);
      }
    }
  }
  protected onStart(): void {}

  protected onDetach(): void {
    this.cleanupCurrentHoldable();
  }

  public async switchToItem(itemId: string | null): Promise<void> {
    // If switching to the same item, do nothing
    if (this.currentItemId === itemId) {
      return;
    }

    console.log(`Switching holdable to ${itemId}`);

    // Clean up current holdable
    this.cleanupCurrentHoldable();

    // If itemId is null or empty, just leave hands empty
    if (!itemId) {
      return;
    }

    // Instantiate new holdable
    await this.createHoldable(itemId);
  }

  private async createHoldable(itemId: string): Promise<void> {
    console.log(`createHoldable ${itemId}`);

    if (!PrefabManager.instance) {
      throw new Error("PrefabManager instance not found");
    }

    // Instantiate the prefab with this entity as parent
    const instance = await PrefabManager.instance.instantiatePrefab(
      itemId,
      itemId,
      {},
      undefined,
      undefined,
      undefined,
      this.holdablesContainerEntity
    ) as TransformNode;

    // Store references
    this.currentItemId = itemId;
    this.currentItem = instance;
    this.currentItemHoldable = instance.behaviors.find(behavior => behavior instanceof HoldableItem) as HoldableItem;
    if (!this.currentItemHoldable) {
      throw new Error("HoldableItem not found");
    }

    // Update IK targets (only if IK is enabled for third-person)
    if (this.iKController) {
      this.iKController.setLeftHandTarget(this.currentItemHoldable.getLeftHandEntity());
      this.iKController.setRightHandTarget(this.currentItemHoldable.getRightHandEntity());
    }
  }

  private cleanupCurrentHoldable(): void {
    if (this.iKController) {
      this.iKController.setLeftHandTarget(null);
      this.iKController.setRightHandTarget(null);
    }

    this.currentItemId = null;
    if (this.currentItem) {
      this.currentItem.dispose();
    }
    this.currentItem = null;
    this.currentItemHoldable = null;
  }
}
