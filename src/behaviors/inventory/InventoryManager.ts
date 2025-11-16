import type { TransformNode } from "@babylonjs/core";
import { Observable } from "@babylonjs/core";
import { BaseSingletonBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { z } from "zod";
import { ItemManager } from "./ItemManager";

export interface InventoryItem {
  itemId: string;
  currentStackSize: number;
}

export interface InventorySlot {
  content: InventoryItem | null;
}

export interface InventorySection {
  allowedType: string | null;
  slots: InventorySlot[];
}

export class InventoryManager extends BaseSingletonBehavior<TransformNode> {
  public name = "InventoryManager";
  public static argsSchema = z.object({
    startingItems: z.array(z.object({
      itemId: z.string().describe("The ID of the item to add"),
      quantity: z.number().optional().default(1).describe("Number of items to add")
    })).describe("Array of items to add to inventory on start")
  }).describe(JSON.stringify({
    summary: "A complete inventory management system with drag-and-drop functionality, item stacking, and section-based organization. Features a survival-style inventory with hotbar (10 slots) and storage area (30 slots). Supports item types, stack limits, drag-and-drop between slots, hotkey selection (1-9, 0), and item discarding (Q key). Integrates with HoldableSwitcher to equip items when selected from hotbar.",
    whenToAttach: "Use when inventory functionality is needed in the game. Configure startingItems to define which items the player starts with.",
    requirementsToAttach: "Must be placed on the `_managers` entity. Requires ItemManager and InputModeManager to be attached. Should be used in conjunction with either InventorySurvival or InventorySingleActiveItem. Player entity must have HoldableSwitcher behavior for holdable item activation.",
    howToEdit: "For new UI layouts with drag-and-drop, extend InventoryGridBase (like InventorySurvival). For different interaction mechanics, extend InventoryUIBase directly. Edit initializeUI() method to use your new UI class."
  } satisfies BehaviorMetadata));

  public static instance: InventoryManager | null = null;

  public static readonly toggleKey = "KeyI";

  public inventorySections: Map<string, InventorySection> = new Map();

  private startingItems: Array<{ itemId: string; quantity: number }>;

  public onInventoryChangedObservable = new Observable<void>();

  constructor(args: unknown) {
    super();
    const validatedArgs = InventoryManager.argsSchema.parse(args);
    this.startingItems = validatedArgs.startingItems;
  }

  public loadData(): void {}

  protected onAwake(): void {}

  protected onStart(): void {
    for (const item of this.startingItems) {
      this.addItem(item.itemId, item.quantity);
    }
  }

  protected onDetach(): void {
    this.inventorySections.clear();
    this.onInventoryChangedObservable.clear();
  }

  public getSlotContents(sectionName: string, slotIndex: number): InventoryItem | null {
    const section = this.inventorySections.get(sectionName);
    if (!section) {
      throw new Error(`Invalid section name: ${sectionName}`);
    }

    const slot = section.slots[slotIndex];
    if (!slot) {
      throw new Error(`Invalid slot index ${slotIndex} for section ${sectionName}`);
    }

    return slot.content;
  }

  public getAllSlots(): InventorySlot[] {
    const allSlots: InventorySlot[] = [];
    for (const section of this.inventorySections.values()) {
      allSlots.push(...section.slots);
    }
    return allSlots;
  }

  public getItemCount(itemId: string): number {
    let totalCount = 0;
    for (const section of this.inventorySections.values()) {
      for (const slot of section.slots) {
        if (slot.content && slot.content.itemId === itemId) {
          totalCount += slot.content.currentStackSize;
        }
      }
    }
    return totalCount;
  }

  public addItem(itemId: string, stackSize: number = 1, targetSection?: string, targetSlot?: number): {section: string, slotIndex: number} | null {
    if (!ItemManager.instance) {
      throw new Error("ItemManager instance not found");
    }

    // Create InventoryItem from ItemManager definition
    const definition = ItemManager.instance.getItem(itemId); // Validates item exists
    const item: InventoryItem = {
      itemId,
      currentStackSize: Math.min(stackSize, definition.maxStackSize)
    };
    if (targetSection && targetSlot !== undefined) {
      const section = this.inventorySections.get(targetSection);
      if (!section) {
        throw new Error(`Invalid section name: ${targetSection}`);
      }
      const slot = section.slots[targetSlot];
      if (!slot) {
        throw new Error(`Invalid slot index ${targetSlot} for section ${targetSection}`);
      }
    }

    const stackResult = this.findStackableSlot(item);
    if (stackResult) {
      this.updateUI();
      return stackResult;
    }

    if (targetSection && targetSlot !== undefined) {
      const section = this.inventorySections.get(targetSection)!;
      const slot = section.slots[targetSlot]!;
      if (!slot.content && this.canSectionHoldItemType(section, item)) {
        slot.content = { ...item };
        this.updateUI();
        return {section: targetSection, slotIndex: targetSlot};
      }
    }

    for (const [sectionName, section] of this.inventorySections) {
      if (this.canSectionHoldItemType(section, item)) {
        for (let i = 0; i < section.slots.length; i++) {
          const slot = section.slots[i]!;
          if (!slot.content) {
            slot.content = { ...item };
            this.updateUI();
            return {section: sectionName, slotIndex: i};
          }
        }
      }
    }

    return null;
  }

  public removeItem(itemId: string, quantity: number = 1): boolean {
    let remainingToRemove = quantity;

    for (const section of this.inventorySections.values()) {
      for (const slot of section.slots) {
        if (slot.content && slot.content.itemId === itemId && remainingToRemove > 0) {
          const amountToRemove = Math.min(remainingToRemove, slot.content.currentStackSize);
          slot.content.currentStackSize -= amountToRemove;
          remainingToRemove -= amountToRemove;

          if (slot.content.currentStackSize <= 0) {
            slot.content = null;
          }
        }
      }
    }

    this.updateUI();
    return remainingToRemove === 0;
  }

  public removeItemFromSlot(sectionName: string, slotIndex: number): InventoryItem | null {
    const section = this.inventorySections.get(sectionName);
    if (!section) {
      throw new Error(`Invalid section name: ${sectionName}`);
    }

    const slot = section.slots[slotIndex];
    if (!slot) {
      throw new Error(`Invalid slot index ${slotIndex} for section ${sectionName}`);
    }

    const item = slot.content;
    slot.content = null;
    this.updateUI();
    return item;
  }

  public moveItem(fromSection: string, fromIndex: number, toSection: string, toIndex: number): {section: string, slotIndex: number} | null {
    const sourceSection = this.inventorySections.get(fromSection);
    if (!sourceSection) {
      throw new Error(`Invalid source section: ${fromSection}`);
    }

    const destSection = this.inventorySections.get(toSection);
    if (!destSection) {
      throw new Error(`Invalid destination section: ${toSection}`);
    }

    const fromSlot = sourceSection.slots[fromIndex];
    if (!fromSlot) {
      throw new Error(`Invalid source slot index ${fromIndex} for section ${fromSection}`);
    }

    const toSlot = destSection.slots[toIndex];
    if (!toSlot) {
      throw new Error(`Invalid destination slot index ${toIndex} for section ${toSection}`);
    }

    if (!fromSlot.content) {
      return null;
    }

    const canMoveToDestination = this.canSectionHoldItemType(destSection, fromSlot.content);
    const canMoveToSource = !toSlot.content || this.canSectionHoldItemType(sourceSection, toSlot.content);

    if (!canMoveToDestination || !canMoveToSource) {
      return null;
    }

    if (toSlot.content) {
      const newStackSize = this.canStackItems(fromSlot.content, toSlot.content);
      if (newStackSize) {
        toSlot.content.currentStackSize = newStackSize;
        fromSlot.content = null;
        this.updateUI();
        return {section: toSection, slotIndex: toIndex};
      }
    }

    const tempItem = fromSlot.content;
    fromSlot.content = toSlot.content;
    toSlot.content = tempItem;

    this.updateUI();
    return {section: toSection, slotIndex: toIndex};
  }

  private canStackItems(sourceItem: InventoryItem, targetItem: InventoryItem): number | null {
    if (!ItemManager.instance) {
      throw new Error("ItemManager instance not found");
    }

    if (sourceItem.itemId === targetItem.itemId) {
      const definition = ItemManager.instance.getItem(targetItem.itemId);
      const total = sourceItem.currentStackSize + targetItem.currentStackSize;
      if (total <= definition.maxStackSize) {
        return total;
      }
    }
    return null;
  }

  private findStackableSlot(item: InventoryItem): {section: string, slotIndex: number} | null {
    if (!ItemManager.instance) {
      throw new Error("ItemManager instance not found");
    }

    for (const [sectionName, section] of this.inventorySections) {
      for (let i = 0; i < section.slots.length; i++) {
        const slot = section.slots[i]!;
        if (slot.content &&
                    slot.content.itemId === item.itemId &&
                    this.canSectionHoldItemType(section, item)) {

          const definition = ItemManager.instance.getItem(slot.content.itemId);
          if (slot.content.currentStackSize + item.currentStackSize <= definition.maxStackSize) {
            slot.content.currentStackSize = slot.content.currentStackSize + item.currentStackSize;
            return {section: sectionName, slotIndex: i};
          }
        }
      }
    }
    return null;
  }

  public canSectionHoldItemType(section: InventorySection, item: InventoryItem): boolean {
    if (!ItemManager.instance) {
      throw new Error("ItemManager instance not found");
    }
    if (section.allowedType === null) {
      return true;
    }

    const definition = ItemManager.instance.getItem(item.itemId);
    return section.allowedType === definition.type;
  }

  private updateUI(): void {
    // Notify all observers that inventory has changed
    this.onInventoryChangedObservable.notifyObservers();
  }
}
