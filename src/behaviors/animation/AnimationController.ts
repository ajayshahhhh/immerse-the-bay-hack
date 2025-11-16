import {
  AnimationGroup,
  Mesh,
  Observable,
  Observer,
  Scene,
} from "@babylonjs/core";

import { BaseBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { z } from "zod";

// Animation state enum
export enum AnimationState {
	IDLE = "Idle",
	WALK_FORWARD = "WalkForward",
	WALK_BACKWARD = "WalkBackward",
	WALK_LEFT = "WalkLeft",
	WALK_RIGHT = "WalkRight",
	RUN_FORWARD = "RunForward",
	RUN_BACKWARD = "RunBackward",
	RUN_LEFT = "RunLeft",
	RUN_RIGHT = "RunRight",
	JUMP_UP = "JumpUp",
	JUMP_FALLING = "JumpFalling"
}

// Animation event interface
export interface AnimationEvent {
	animationName: AnimationState;
	eventType: "start" | "end" | "loop";
}

// Blend information interface
interface BlendInfo {
	fromState: AnimationState;
	toState: AnimationState;
	progress: number;
	duration: number;
}

// State machine interfaces
export interface AnimationSingleNode {
	type: "single";
	id: string;
	state: AnimationState;
	speed: number;
	loop: boolean;
}

export interface AnimationBlendNode {
	type: "blend";
	id: string;
	animations: Array<{
		state: AnimationState;
		position: { x: number; z: number };
	}>;
}

export type AnimationNode = AnimationSingleNode | AnimationBlendNode;

export interface TransitionCondition {
	variable: string;
	operator: '==' | '!=' | '>' | '<' | '>=' | '<=';
	value: number | boolean;
}

export interface AnimationTransition {
	from: string;
	to: string;
	conditions: TransitionCondition[];
	crossFadeDuration: number;
}

// Define the animation state machine structure
const ANIMATION_NODES: AnimationNode[] = [
  {
    type: "blend",
    id: "movement",
    animations: [
      { state: AnimationState.IDLE, position: { x: 0, z: 0 } },
      { state: AnimationState.WALK_FORWARD, position: { x: 0, z: 1 } },
      { state: AnimationState.WALK_BACKWARD, position: { x: 0, z: -1 } },
      { state: AnimationState.WALK_LEFT, position: { x: -1, z: 0 } },
      { state: AnimationState.WALK_RIGHT, position: { x: 1, z: 0 } },
      { state: AnimationState.RUN_FORWARD, position: { x: 0, z: 2 } },
      { state: AnimationState.RUN_BACKWARD, position: { x: 0, z: -2 } },
      { state: AnimationState.RUN_LEFT, position: { x: -2, z: 0 } },
      { state: AnimationState.RUN_RIGHT, position: { x: 2, z: 0 } }
    ]
  },
  {
    type: "single",
    id: "JumpUp",
    state: AnimationState.JUMP_UP,
    speed: 1.0,
    loop: false
  },
  {
    type: "single",
    id: "JumpFalling",
    state: AnimationState.JUMP_FALLING,
    speed: 1.0,
    loop: true
  }
];

const ANIMATION_TRANSITIONS: AnimationTransition[] = [
  {
    from: "movement",
    to: "JumpUp",
    conditions: [
      { variable: "isJumping", operator: "==", value: true }
    ],
    crossFadeDuration: 0
  },
  {
    from: "JumpUp",
    to: "JumpFalling",
    conditions: [],
    crossFadeDuration: 0
  },
  {
    from: "JumpFalling",
    to: "movement",
    conditions: [
      { variable: "isJumping", operator: "==", value: false }
    ],
    crossFadeDuration: 0
  }
];

const INITIAL_NODE_ID = "movement";

export class AnimationController extends BaseBehavior<Mesh> {
  public name = "AnimationController";
  public static argsSchema = z.object({}).describe(JSON.stringify({
    summary: "An advanced animation state machine controller that manages character animations with smooth blending, cross-fading, and condition-based transitions. Automatically discovers animation groups from loaded GLB files and maps them to animation states. Features a directed graph state machine with customizable transitions based on numeric or boolean variables, configurable animation speed and looping per state, easing functions for natural animation transitions, event system for animation callbacks, and seamless integration with MovementController for automatic state-driven animation playback.",
    whenToAttach: "Is part of player prefabs (ThirdPersonPlayer, FirstPersonPlayer), but can also be manually attached to any animated mesh entity. Use when you have animated character meshes that need state-driven animation control with conditional transitions.",
    requirementsToAttach: "Must be attached to a `standard/CustomMesh` entity that loads a GLB file with animation tracks. Animation track names must match AnimationState enum values (Idle, WalkForward, WalkBackward, WalkLeft, WalkRight, RunForward, RunBackward, RunLeft, RunRight, Jump).",
    howToEdit: "Edit the file directly."
  } satisfies BehaviorMetadata));

  private beforeRenderObserver: Observer<Scene> | null = null;

  // Node tracking by ID
  private currentNodeId: string;
  private nodes: Map<string, AnimationNode> = new Map();

  // Animation group mapping (still by AnimationState)
  private animationGroups: Map<AnimationState, AnimationGroup> = new Map();

  // Blending system for cross-fades
  private activeBlend: BlendInfo | null = null;

  // Blend node weights (for 2D blending)
  private blendWeights: Map<AnimationState, number> = new Map();

  // State machine data
  private transitions: AnimationTransition[] = [];
  private variables: Map<string, number | boolean> = new Map();

  // Animation event system
  public onAnimationEvent = new Observable<AnimationEvent>();

  constructor(args: unknown) {
    super();
    AnimationController.argsSchema.parse(args);

    // Setup nodes - store all by ID
    for (const node of ANIMATION_NODES) {
      // Validate no duplicate IDs
      if (this.nodes.has(node.id)) {
        throw new Error(`Duplicate node ID: ${node.id}`);
      }
      this.nodes.set(node.id, node);
      console.log(this.nodes.has(node.id) + " has node " +  node.id);
    }

    // Setup transitions
    this.transitions = ANIMATION_TRANSITIONS;

    // Validate transition references
    for (const transition of this.transitions) {
      if (!this.nodes.has(transition.from)) {
        throw new Error(`Transition references unknown node: ${transition.from}`);
      }
      if (!this.nodes.has(transition.to)) {
        throw new Error(`Transition references unknown node: ${transition.to}`);
      }
    }

    // Set initial node
    if (!this.nodes.has(INITIAL_NODE_ID)) {
      throw new Error(`Initial node references unknown node: ${INITIAL_NODE_ID}`);
    }
    this.currentNodeId = INITIAL_NODE_ID;
  }

  protected onAwake(): void {
    this.setupAnimations();
  }

  protected onStart(): void {
    this.beforeRenderObserver = this.scene.onBeforeRenderObservable.add(() => {
      this.updateCrossFade();
      this.update();
    });
  }

  protected onDetach(): void {
    if (this.beforeRenderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.beforeRenderObserver);
      this.beforeRenderObserver = null;
    }
    // Stop all animations
    this.stopAllAnimations();

    // Clean up event observers
    this.onAnimationEvent.clear();
  }

  private setupAnimations(): void {
    // Find animation groups that belong to this mesh/node
    for (const animationGroup of this.scene.animationGroups) {
      // Check if this animation targets our node or its children
      const targetsThisNode = animationGroup.targetedAnimations.some(ta => {
        // Check if the target is this node or a child of this node
        let current = ta.target;
        while (current) {
          if (current === this.node) return true;
          current = current.parent;
        }
        return false;
      });
      if (!targetsThisNode) {
        continue;
      }

      // Match animation name with our enum values
      const matchingState = Object.values(AnimationState).find(state => state === animationGroup.name);
      if (!matchingState) {
        continue;
      }
      this.animationGroups.set(matchingState, animationGroup);

      // Set animation group properties
      animationGroup?.stop();
      animationGroup?.setWeightForAllAnimatables(0);

      // Apply node configuration if this state belongs to a single node
      let singleNodeConfig: AnimationSingleNode | null = null;
      for (const node of this.nodes.values()) {
        if (node.type === "single" && node.state === matchingState) {
          singleNodeConfig = node;
          break;
        }
      }

      if (singleNodeConfig && animationGroup) {
        animationGroup.loopAnimation = singleNodeConfig.loop;
        animationGroup.speedRatio = singleNodeConfig.speed;
      } else if (animationGroup) {
        // Default behavior for blend node animations
        animationGroup.loopAnimation = true;
        animationGroup.speedRatio = 1.0;
      }

      // Add animation event listeners
      this.setupAnimationEvents(animationGroup, matchingState);
    }

    console.log(`Animation groups`);
    console.log(this.animationGroups);

    // Play initial node
    this.playNode(this.currentNodeId, 0);
  }

  private setupAnimationEvents(animGroup: AnimationGroup, state: AnimationState): void {
    // Animation start event
    animGroup.onAnimationGroupPlayObservable.add(() => {
      this.onAnimationEvent.notifyObservers({
        animationName: state,
        eventType: "start"
      });
    });

    // Animation end event
    animGroup.onAnimationGroupEndObservable.add(() => {
      this.onAnimationEvent.notifyObservers({
        animationName: state,
        eventType: "end"
      });
    });

    // Animation loop event
    animGroup.onAnimationGroupLoopObservable.add(() => {
      this.onAnimationEvent.notifyObservers({
        animationName: state,
        eventType: "loop"
      });
    });
  }

  // Main method to play node
  public playNode(nodeId: string, crossFadeDuration: number): void {
    // If already current node and no blending, return
    if (this.currentNodeId === nodeId && !this.activeBlend) {
      return;
    }

    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node '${nodeId}' not found`);
    }

    // Record previous state

    try {
      if (node.type === "blend") {
        this.startBlendNode(node, crossFadeDuration);
      } else if (node.type === "single") {
        this.startSingleNode(node, crossFadeDuration);
      }
    } catch (error) {
      console.warn('Playing animation failed', error);
    } finally {
      this.currentNodeId = nodeId;
    }
  }

  private startSingleNode(node: AnimationSingleNode, crossFadeDuration: number): void {
    const animGroup = this.animationGroups.get(node.state);
    if (!animGroup) {
      throw new Error(`Animation state '${node.state}' not found, skipping`);
    }

    if (crossFadeDuration > 0) {
      this.startCrossFade(node.state, crossFadeDuration);
    } else {
      this.playAnimationImmediate(node.state);
    }
  }

  private playAnimationImmediate(state: AnimationState): void {
    // Stop all other animations
    this.stopAllAnimations();

    // Play target animation
    const animGroup = this.animationGroups.get(state);
    animGroup?.setWeightForAllAnimatables(1);
    animGroup?.start();  // Use configured loopAnimation property
  }

  private startCrossFade(toState: AnimationState, crossFadeDuration: number): void {

    //Cancel current blend
    if (this.activeBlend) {
      this.completeCrossFade();
    }

    const toAnimGroup = this.animationGroups.get(toState);
    if (!toAnimGroup) return;
    toAnimGroup.setWeightForAllAnimatables(1);
    toAnimGroup.start();


    const prevState = this.getDominantAnimationState(this.currentNodeId);
    // Create new blend information
    this.activeBlend = {
      fromState: prevState,
      toState: toState,
      progress: 0,
      duration: crossFadeDuration
    };
  }

  private updateCrossFade(): void {
    if (!this.activeBlend) return;

    // Update blend progress using scene deltaTime (in seconds)
    this.activeBlend.progress += this.scene.deltaTime / this.activeBlend.duration;

    if (this.activeBlend.progress >= 1) {
      // Blend complete
      this.completeCrossFade();
    } else {
      // Update weights
      this.updateCrossFadeWeights();
    }
  }

  private updateCrossFadeWeights(): void {
    if (!this.activeBlend) return;

    const progress = this.activeBlend.progress;

    // Use easing function to make blending more natural
    const easeProgress = this.easeInOutQuad(progress);

    // Check if we're transitioning to a blend node
    const currentNode = this.nodes.get(this.activeBlend.toState);

    if (currentNode && currentNode.type === "blend") {
      // Cross-fading to a blend node - distribute weight across all blend animations
      for (const [state, targetWeight] of this.blendWeights.entries()) {
        const animGroup = this.animationGroups.get(state);
        // Apply blend weight scaled by cross-fade progress
        animGroup?.setWeightForAllAnimatables(targetWeight * easeProgress);
      }
    } else {
      // Normal cross-fade to single animation
      const toAnimGroup = this.animationGroups.get(this.activeBlend.toState);
      toAnimGroup?.setWeightForAllAnimatables(easeProgress);
    }

    // Check if we're transitioning FROM a blend node
    const previousNode = this.nodes.get(this.activeBlend.fromState);
    if (previousNode && previousNode.type === "blend") {
      // Fade out ALL animations from the blend node
      for (const anim of previousNode.animations) {
        const animGroup = this.animationGroups.get(anim.state);
        // Get the initial weight for this animation
        const initialWeight = this.blendWeights.get(anim.state) || 0;
        // Fade it out proportionally
        animGroup?.setWeightForAllAnimatables(initialWeight * (1 - easeProgress));
      }
    } else {
      // Update source animation weight (single node case)
      const fromAnimGroup = this.animationGroups.get(this.activeBlend.fromState);
      fromAnimGroup?.setWeightForAllAnimatables(1 - easeProgress);
    }
  }

  private completeCrossFade(): void {
    if (!this.activeBlend) return;

    const currentNode = this.nodes.get(this.currentNodeId);
    if (!currentNode) {
      throw new Error(`to state not found: ${this.currentNodeId}`);
    }

    const previousNode = this.nodes.get(this.activeBlend.fromState);

    if (currentNode.type === "blend") {
      // Transitioning TO blend node - ensure final blend weights are applied
      // (they should already be at their target values from updateBlendWeights)
      for (const [state, targetWeight] of this.blendWeights.entries()) {
        const animGroup = this.animationGroups.get(state);
        animGroup?.setWeightForAllAnimatables(targetWeight);
      }
    } else {
      // Transitioning TO single node - set final weight
      const toAnimGroup = this.animationGroups.get(this.activeBlend.toState);
      toAnimGroup?.setWeightForAllAnimatables(1);
    }

    // Stop previous animations
    if (previousNode && previousNode.type === "blend") {
      // Stop ALL animations from the previous blend node
      for (const anim of previousNode.animations) {
        const animGroup = this.animationGroups.get(anim.state);
        animGroup?.stop();
        animGroup?.setWeightForAllAnimatables(0);
      }
    } else {
      // Stop single animation from previous single node
      const fromAnimGroup = this.animationGroups.get(this.activeBlend.fromState);
      fromAnimGroup?.stop();
      fromAnimGroup?.setWeightForAllAnimatables(0);
    }

    // Clean up blend state
    this.activeBlend = null;
  }

  private easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  private stopAllAnimations(): void {
    this.animationGroups.forEach(animGroup => {
      if (animGroup?.isPlaying) {
        animGroup?.stop();
        animGroup?.setWeightForAllAnimatables(0);
      }
    });
  }

  private startBlendNode(node: AnimationBlendNode, crossFadeDuration: number): void {
    // Calculate initial blend weights based on current variables
    this.updateBlendNodeWeights(node);

    if (crossFadeDuration > 0) {
      // Cross-fade from previous node to blend node
      this.startBlendCrossFade(node, crossFadeDuration);
    } else {
      // Immediate switch to blend node
      this.stopAllAnimations();
      this.applyBlendNodeWeights();
    }
  }

  private updateBlendNodeWeights(blendNode: AnimationBlendNode): void {
    const x = (this.variables.get("directionX") as number) || 0;
    const z = (this.variables.get("directionZ") as number) || 0;

    // Calculate weights based on inverse distance to each animation position
    const weights: Map<AnimationState, number> = new Map();
    let totalWeight = 0;

    for (const anim of blendNode.animations) {
      const dx = x - anim.position.x;
      const dz = z - anim.position.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      // Use inverse distance weighting (closer = higher weight)
      // Add small epsilon to avoid division by zero
      const weight = 1 / (distance + 0.001);
      weights.set(anim.state, weight);
      totalWeight += weight;
    }

    // Normalize weights to sum to 1
    this.blendWeights.clear();
    for (const [state, weight] of weights.entries()) {
      this.blendWeights.set(state, weight / totalWeight);
    }
  }

  private applyBlendNodeWeights(): void {
    for (const [state, weight] of this.blendWeights.entries()) {
      const animGroup = this.animationGroups.get(state);
      // Ensure animation is playing
      if (animGroup && !animGroup.isPlaying) {
        animGroup.start();  // Use configured loopAnimation property
      }
      animGroup?.setWeightForAllAnimatables(weight);
    }
  }

  private startBlendCrossFade(toBlendNode: AnimationBlendNode, crossFadeDuration: number): void {
    
    // Start all blend animations at 0 weight
    for (const anim of toBlendNode.animations) {
      const animGroup = this.animationGroups.get(anim.state);
      animGroup?.setWeightForAllAnimatables(0);
      animGroup?.start();  // Use configured loopAnimation property
    }

    const dominantState = this.getDominantAnimationState(toBlendNode.id);

    // Create blend info for cross-fade
    const prevState = this.getDominantAnimationState(this.currentNodeId);
    this.activeBlend = {
      fromState: prevState,
      toState: dominantState,
      progress: 0,
      duration: crossFadeDuration
    };
  }

  private getDominantAnimationState(nodeId:string): AnimationState {
    const currentNode = this.nodes.get(nodeId);
    if (!currentNode) {
      throw new Error(`Previous node not found: ${nodeId}`);
    }

    if (currentNode.type === "single") {
      return currentNode.state;
    } else {
      // For blend node, return the dominant animation (highest weight)
      let dominantState: AnimationState = currentNode.animations[0].state;
      let maxWeight = 0;

      for (const anim of currentNode.animations) {
        const weight = this.blendWeights.get(anim.state) || 0;
        if (weight > maxWeight) {
          maxWeight = weight;
          dominantState = anim.state;
        }
      }

      return dominantState;
    }
  }

  // State machine public API
  public setVariable(name: string, value: number | boolean): void {
    this.variables.set(name, value);
  }

  public getVariable(name: string): number | boolean | undefined {
    return this.variables.get(name);
  }

  public update(): void {
    const currentNode = this.nodes.get(this.currentNodeId);
    if (!currentNode) {
      throw new Error(`Current node not found: ${this.currentNodeId}`);
    }

    // If in blend node, update weights continuously
    if (currentNode.type === "blend") {
      this.updateBlendNodeWeights(currentNode);

      // Only apply weights if not in the middle of a cross-fade
      if (!this.activeBlend) {
        this.applyBlendNodeWeights();
      }
    }

    // Evaluate transitions
    const transition = this.evaluateTransitions();
    if (transition) {
      this.playNode(transition.to, transition.crossFadeDuration);
    }
  }

  // State machine transition evaluation
  private evaluateTransitions(): AnimationTransition | null {
    // Find all transitions from current node
    for (const transition of this.transitions) {
      if (transition.from !== this.currentNodeId) continue;

      // Handle automatic transitions (empty conditions)
      if (transition.conditions.length === 0) {
        // Check if current animation has finished (for single nodes)
        const currentNode = this.nodes.get(this.currentNodeId);
        if (currentNode && currentNode.type === "single") {
          const animGroup = this.animationGroups.get(currentNode.state);
          if (animGroup && !animGroup?.isPlaying) {
            return transition;
          }
        }
        continue;
      }

      // Check if all conditions are met (AND logic)
      const allConditionsMet = transition.conditions.every(condition =>
        this.evaluateCondition(condition)
      );

      if (allConditionsMet) {
        return transition; // Return first valid transition
      }
    }

    return null;
  }

  private evaluateCondition(condition: TransitionCondition): boolean {
    const value = this.variables.get(condition.variable);

    // If variable doesn't exist, condition fails
    if (value === undefined) return false;

    const targetValue = condition.value;

    switch (condition.operator) {
    case '==':
      return value === targetValue;
    case '!=':
      return value !== targetValue;
    case '>':
      return typeof value === 'number' && typeof targetValue === 'number' && value > targetValue;
    case '<':
      return typeof value === 'number' && typeof targetValue === 'number' && value < targetValue;
    case '>=':
      return typeof value === 'number' && typeof targetValue === 'number' && value >= targetValue;
    case '<=':
      return typeof value === 'number' && typeof targetValue === 'number' && value <= targetValue;
    default:
      return false;
    }
  }
}
