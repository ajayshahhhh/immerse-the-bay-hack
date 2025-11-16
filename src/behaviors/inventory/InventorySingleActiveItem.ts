import type { Observer, Scene, TransformNode } from "@babylonjs/core";
import { BaseSingletonBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { z } from "zod";
import { InventoryManager, type InventorySection, type InventoryItem, type InventorySlot } from "./InventoryManager";
import { ItemManager } from "./ItemManager";
import { HoldableSwitcher } from "../holdables/HoldableSwitcher";

export class InventorySingleActiveItem extends BaseSingletonBehavior<TransformNode> {
  public name = "InventorySingleActiveItem";
  public static argsSchema = z.object({
    playerEntityId: z.string().describe("The entity ID of the player character that owns this inventory and has the HoldableSwitcher behavior for equipping the active item")
  }).describe(JSON.stringify({
    summary: "A minimal inventory implementation with a single slot. No UI or no slot selection. Integrates with HoldableSwitcher to equip the item.",
    whenToAttach: "Use when a single active item is needed. Player entity must have HoldableSwitcher behavior for holdable item activation.",
    requirementsToAttach: "Must be placed on the `_managers` entity. Requires ItemManager and InventoryManager to be attached.",
    howToEdit: "Edit the file directly."
  } satisfies BehaviorMetadata));

  private beforeRenderObserver: Observer<Scene> | null = null;

  public static instance: InventorySingleActiveItem | null = null;

  private playerEntityId: string;
  private playerHoldableSwitcher!: HoldableSwitcher;
  private lastActiveItem: InventoryItem | null = null;

  constructor(args: unknown) {
    super();
    const validatedArgs = InventorySingleActiveItem.argsSchema.parse(args);
    this.playerEntityId = validatedArgs.playerEntityId;
  }

  public static createInventorySections(): Map<string, InventorySection> {
    const sections = new Map<string, InventorySection>();

    const singleSlot: InventorySlot[] = [{ content: null }];

    sections.set("active", {
      allowedType: null,
      slots: singleSlot
    });

    return sections;
  }

  public loadData(): void {}

  protected onAwake(): void {
    if (!InventoryManager.instance) {
      throw new Error("InventoryManager instance not found");
    }
    InventoryManager.instance.inventorySections = InventorySingleActiveItem.createInventorySections();

    // Find the player's HoldableSwitcher
    const playerEntity = this.scene.getNodeById(this.playerEntityId);
    if (!playerEntity) {
      throw new Error(`Player ${this.playerEntityId} not found`);
    }

    const holdablesSwitcher = playerEntity.behaviors.find(
      behavior => behavior instanceof HoldableSwitcher
    ) as HoldableSwitcher;
    if (!holdablesSwitcher) {
      throw new Error(`HoldableSwitcher not found on player ${this.playerEntityId}`);
    }
    this.playerHoldableSwitcher = holdablesSwitcher;
  }

  protected onStart(): void {
    // Set up the render loop to monitor active item changes
    this.beforeRenderObserver = this.scene.onBeforeRenderObservable.add(() => {
      this.checkActiveItemChanges();
    });
  }

  protected onDetach(): void {
    if (this.beforeRenderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.beforeRenderObserver);
      this.beforeRenderObserver = null;
    }
    this.lastActiveItem = null;
  }

  private checkActiveItemChanges(): void {
    if (!InventoryManager.instance) {
      throw new Error("InventoryManager instance not found");
    }

    const currentActiveItem = InventoryManager.instance.getSlotContents("active", 0);

    // Compare items (handle null cases and deep comparison)
    const hasChanged = (this.lastActiveItem === null) !== (currentActiveItem === null) || (this.lastActiveItem !== null && currentActiveItem !== null && (this.lastActiveItem.itemId !== currentActiveItem.itemId || this.lastActiveItem.currentStackSize !== currentActiveItem.currentStackSize));

    if (hasChanged) {
      this.onActiveItemChange(currentActiveItem);
      this.lastActiveItem = currentActiveItem ? { ...currentActiveItem } : null;
    }
  }

  public onActiveItemChange(item: InventoryItem | null): void {
    if (!ItemManager.instance) {
      throw new Error("ItemManager instance not found");
    }

    if (!item) {
      this.playerHoldableSwitcher.switchToItem(null);
      return;
    }

    const itemDefinition = ItemManager.instance.getItem(item.itemId);

    console.log(`onActiveItemChange ${itemDefinition.prefabId}`);
    // Only try to instantiate holdable if prefabId is not empty
    this.playerHoldableSwitcher.switchToItem(itemDefinition.prefabId || null);
  }
}
