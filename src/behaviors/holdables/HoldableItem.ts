import { TransformNode } from "@babylonjs/core";
import { BaseBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { z } from "zod";

export class HoldableItem extends BaseBehavior<TransformNode> {
  public name = "HoldableItem";
  public static argsSchema = z.object({
    leftHandEntityId: z.string().optional().describe("Entity ID of the left hand target position within the holdable item"),
    rightHandEntityId: z.string().optional().describe("Entity ID of the right hand target position within the holdable item")
  }).describe(JSON.stringify({
    summary: "Manages references to left and right hand positioning nodes for holdable items. Provides target positions for IKController to place character hands realistically when holding tools, weapons, or other objects. Each holdable item prefab should have this behavior to define where the character's hands should be positioned.",
    whenToAttach: "Must be attached to every holdable item prefab that characters can hold. Used by HoldableSwitcher to determine hand positioning when items are equipped.",
    requirementsToAttach: "Must be attached to the root entity of a holdable item prefab. The specified hand target entities must exist as children of the holdable item for proper hand positioning.",
    howToEdit: "Edit the file directly. Ensure that hand target entities are positioned correctly for natural hand placement on the item."
  } satisfies BehaviorMetadata));

  private leftHandEntityId?: string;
  private rightHandEntityId?: string;
  private leftHandEntity: TransformNode | null = null;
  private rightHandEntity: TransformNode | null = null;

  constructor(args: unknown) {
    super();
    const validatedArgs = HoldableItem.argsSchema.parse(args);
    this.leftHandEntityId = validatedArgs.leftHandEntityId;
    this.rightHandEntityId = validatedArgs.rightHandEntityId;
  }

  protected onAwake(): void {
    if (this.leftHandEntityId) {
      const node = this.scene.getNodeById(this.leftHandEntityId);
      if (!node) {
        throw new Error(`Left hand node ${this.leftHandEntityId} not found`);
      }
      this.leftHandEntity = node as TransformNode;
    }

    if (this.rightHandEntityId) {
      const node = this.scene.getNodeById(this.rightHandEntityId);
      if (!node) {
        throw new Error(`Right hand node ${this.rightHandEntityId} not found`);
      }
      this.rightHandEntity = node as TransformNode;
    }
  }

  protected onStart(): void {}
  protected onDetach(): void {}

  public getLeftHandEntity(): TransformNode | null {
    return this.leftHandEntity;
  }

  public getRightHandEntity(): TransformNode | null {
    return this.rightHandEntity;
  }
}
