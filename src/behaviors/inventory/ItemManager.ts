import type { TransformNode } from "@babylonjs/core";
import { BaseSingletonBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { z } from "zod";

export interface Item {
    name: string;
    type: string;
    image: string;
    maxStackSize: number;
    prefabId?: string;
}

export class ItemManager extends BaseSingletonBehavior<TransformNode> {
  public name = "ItemManager";
  public static argsSchema = z.object({}).describe(JSON.stringify({
    summary: "A singleton registry that stores item definitions. Defines available items with their properties: `name`, `type`, `image`, `maxStackSize`, and optionally `prefabId`. `prefabId` determines the prefab that is instantiated when item is activated by InventoryManager. Not all items need to have a visual representation, only holdable items do.",
    whenToAttach: "Required whenever InventoryManager is used.",
    requirementsToAttach: "Must be placed on the `_managers` entity. Items with `prefabId` must correspond to an existing prefab in `prefabLibrary.json`.",
    howToEdit: "Edit the file directly. Item definitions are loaded from `items.json`."
  } satisfies BehaviorMetadata));

  public static instance: ItemManager | null = null;

  private items: Map<string, Item> = new Map();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public loadData(args: Record<string, any>) {
    for (const [itemId, itemProperties] of Object.entries(args)) {
      this.items.set(itemId, itemProperties);
    }
  }

  protected onAwake(): void {}

  protected onStart(): void {}

  public getItem(itemId: string): Item {
    const definition = this.items.get(itemId);
    if (!definition) {
      throw new Error(`Item definition not found: ${itemId}`);
    }
    return definition;
  }

  protected onDetach(): void {
    this.items.clear();
  }
}
