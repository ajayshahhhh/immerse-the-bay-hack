import type { Observer, Scene, TransformNode } from "@babylonjs/core";
import { BaseSingletonBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { z } from "zod";
import { InventoryManager, type InventorySection, type InventoryItem, type InventorySlot } from "./InventoryManager";
import { InventorySurvivalUI } from "./InventorySurvivalUI";
import { ItemManager } from "./ItemManager";
import { HoldableSwitcher } from "../holdables/HoldableSwitcher";
import { INVENTORY_SURVIVAL_CONSTS } from "./InventorySurvivalConsts";

export class InventorySurvival extends BaseSingletonBehavior<TransformNode> {
  public name = "InventorySurvival";
  public static argsSchema = z.object({
    playerEntityId: z.string().describe("The entity ID of the player character that owns this inventory and has the HoldableSwitcher behavior for equipping items from the hotbar")
  }).describe(JSON.stringify({
    summary: "A complete inventory management system with drag-and-drop functionality, item stacking, and section-based organization. Features a survival-style inventory with hotbar (10 slots) and storage area (30 slots). Supports drag and drop between slots, and using number keys to switch active item in the hotkey. Integrates with HoldableSwitcher to equip items when selected from hotbar.",
    whenToAttach: "Use when inventory functionality is needed in the game.",
    requirementsToAttach: "Must be placed on the `_managers` entity. Requires ItemManager and InputModeManager to be attached. Player entity must have HoldableSwitcher behavior for holdable item activation.",
    howToEdit: "For new UI layouts with drag-and-drop, extend InventoryGridBase (like InventorySurvival). For different interaction mechanics, extend InventoryUIBase directly. Edit initializeUI() method to use your new UI class."
  } satisfies BehaviorMetadata));

  private beforeRenderObserver: Observer<Scene> | null = null;
  private inventoryChangedObserver: Observer<void> | null = null;

  public static instance: InventorySurvival | null = null;

  private playerEntityId: string;
  private playerHoldableSwitcher!: HoldableSwitcher;
  private uiClass: InventorySurvivalUI | null = null;
  private lastActiveItem: InventoryItem | null = null;

  constructor(args: unknown) {
    super();
    const validatedArgs = InventorySurvival.argsSchema.parse(args);
    this.playerEntityId = validatedArgs.playerEntityId;
  }

  public static createInventorySections(): Map<string, InventorySection> {
    const sections = new Map<string, InventorySection>();

    const hotbarSlots: InventorySlot[] = [];
    for (let i = 0; i < INVENTORY_SURVIVAL_CONSTS.HOTBAR_SLOTS; i++) {
      hotbarSlots.push({ content: null });
    }

    const storageSlots: InventorySlot[] = [];
    for (let i = 0; i < INVENTORY_SURVIVAL_CONSTS.STORAGE_SLOTS; i++) {
      storageSlots.push({ content: null });
    }

    sections.set("hotbar", {
      allowedType: null,
      slots: hotbarSlots
    });

    sections.set("storage", {
      allowedType: null,
      slots: storageSlots
    });

    return sections;
  }

  public loadData(): void {}

  protected onAwake(): void {
    if (!InventoryManager.instance) {
      throw new Error("InventoryManager instance not found");
    }
    InventoryManager.instance.inventorySections = InventorySurvival.createInventorySections();

    // Subscribe to inventory changes
    this.inventoryChangedObserver = InventoryManager.instance.onInventoryChangedObservable.add(() => {
      this.updateDisplay();
    });

    // Create and initialize the UI
    this.uiClass = new InventorySurvivalUI(this.scene);
    this.uiClass.initialize();

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
      if (this.uiClass) {
        this.uiClass.updateHotbarVisibility();
      }
    });
  }

  protected onDetach(): void {
    if (this.beforeRenderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.beforeRenderObserver);
      this.beforeRenderObserver = null;
    }
    if (this.uiClass) {
      this.uiClass.dispose();
      this.uiClass = null;
    }
    if (InventoryManager.instance && this.inventoryChangedObserver) {
      InventoryManager.instance.onInventoryChangedObservable.remove(this.inventoryChangedObserver);
      this.inventoryChangedObserver = null;
    }
    this.lastActiveItem = null;
  }

  private checkActiveItemChanges(): void {
    if (!InventoryManager.instance) {
      throw new Error("InventoryManager instance not found");
    }
    if (!this.uiClass) {
      throw new Error("uiClass instance not defined");
    }

    const currentActiveItem = InventoryManager.instance.getSlotContents("hotbar", this.uiClass.getCurrentActiveSlotIndex());

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

  public updateDisplay(): void {
    if (!InventoryManager.instance) {
      throw new Error("InventoryManager instance not found");
    }
    if (!this.uiClass) {
      throw new Error("uiClass instance not defined");
    }
    this.uiClass.updateDisplay(InventoryManager.instance.getAllSlots());
  }
}
