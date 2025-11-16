import { BaseBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { TransformNode, Vector3 } from "@babylonjs/core";
import { z } from "zod";

export class EnemyFigure extends BaseBehavior<TransformNode> {
  public name = "EnemyFigure";
  public static argsSchema = z.object({
    playerEntityId: z.string().default("player").describe("Entity ID of the player"),
    spawnMinTime: z.number().default(15000).describe("Minimum time between spawns in milliseconds"),
    spawnMaxTime: z.number().default(30000).describe("Maximum time between spawns in milliseconds"),
    initialDelay: z.number().default(10000).describe("Delay before first spawn timer starts (after player moves)"),
    visibleDuration: z.number().default(4000).describe("How long the figure stays visible"),
    rushSpeed: z.number().default(15).describe("Speed when rushing toward player"),
    spawnDistance: z.number().default(15).describe("Distance from player to spawn"),
    jumpscareDistance: z.number().default(2).describe("Distance to trigger jumpscare")
  }).describe(JSON.stringify({
    summary: "Enemy figure that spawns near player, watches them, and attacks if it has line of sight.",
    whenToAttach: "Attach to the enemy figure entity.",
    requirementsToAttach: "Player entity must exist.",
    howToEdit: "Edit the file directly."
  } satisfies BehaviorMetadata));

  private playerEntityId: string;
  private spawnMinTime: number;
  private spawnMaxTime: number;
  private initialDelay: number;
  private visibleDuration: number;
  private rushSpeed: number;
  private jumpscareDistance: number;

  private playerNode: TransformNode | null = null;
  private playerStartPosition: Vector3 = Vector3.Zero();
  private hasPlayerMoved: boolean = false;
  private gameStarted: boolean = false;
  private spawnTimer: number = 0;
  private nextSpawnTime: number = 0;
  private isVisible: boolean = false;
  private visibilityTimer: number = 0;
  private isRushing: boolean = false;
  private isJumpscaring: boolean = false;
  private floorTiles: TransformNode[] = [];
  private lockedPosition: Vector3 | null = null;

  constructor(args: unknown) {
    super();
    const validatedArgs = EnemyFigure.argsSchema.parse(args);
    this.playerEntityId = validatedArgs.playerEntityId;
    this.spawnMinTime = validatedArgs.spawnMinTime;
    this.spawnMaxTime = validatedArgs.spawnMaxTime;
    this.initialDelay = validatedArgs.initialDelay;
    this.visibleDuration = validatedArgs.visibleDuration;
    this.rushSpeed = validatedArgs.rushSpeed;
    this.jumpscareDistance = validatedArgs.jumpscareDistance;
  }

  protected onAwake(): void {
    // Make sure figure is not parented to anything
    this.node.parent = null;
    
    // Find player
    this.playerNode = this.scene.getTransformNodeByName(this.playerEntityId);
    if (this.playerNode) {
      this.playerStartPosition = this.playerNode.position.clone();
    }

    // Find all wooden floor tiles for spawning
    this.floorTiles = [];
    const allNodes = this.scene.transformNodes;
    for (const node of allNodes) {
      // Match wooden_floor_texture entities (parent entities, not mesh children)
      if (node.name.includes("wooden_floor_texture") && !node.name.includes("_mesh")) {
        this.floorTiles.push(node);
      }
    }
    
    console.log(`Found ${this.floorTiles.length} wooden floor spawn locations`);

    // Make sure the figure doesn't have physics that could move it
    this.node.physicsBody = null;

    // Start invisible
    this.node.setEnabled(false);
    this.isVisible = false;
  }

  protected onStart(): void {
    // Make figure always visible
    this.node.setEnabled(true);
    
    this.scene.onBeforeRenderObservable.add(() => {
      this.update();
    });
  }

  private update(): void {
    const deltaTime = this.scene.getEngine().getDeltaTime();

    if (!this.playerNode) return;

    // Check if player has moved
    if (!this.hasPlayerMoved && !this.gameStarted) {
      const currentPos = this.playerNode.position;
      const startPos = this.playerStartPosition;
      const distance = Vector3.Distance(currentPos, startPos);
      
      if (distance > 0.5) {
        this.hasPlayerMoved = true;
        this.gameStarted = true;
        this.nextSpawnTime = this.initialDelay;
        this.spawnTimer = 0;
      }
    }

    // Handle spawn timer
    if (this.gameStarted && !this.isVisible && !this.isRushing && !this.isJumpscaring) {
      this.spawnTimer += deltaTime;

      if (this.spawnTimer >= this.nextSpawnTime) {
        this.spawnFigure();
        this.spawnTimer = 0;
      }
    }

    // Handle visibility
    if (this.isVisible && !this.isRushing) {
      this.visibilityTimer += deltaTime;

      // LOCK POSITION - aggressively force position every frame
      if (this.lockedPosition) {
        this.node.position.copyFrom(this.lockedPosition);
        this.node.computeWorldMatrix(true);
      }

      // TEMPORARILY DISABLED: Rotate to face player (testing if this causes movement)
      // this.facePlayer();

      // Check if visibility duration is over
      if (this.visibilityTimer >= this.visibleDuration) {
        // LOCK POSITION before line of sight check
        if (this.lockedPosition) {
          this.node.position.copyFrom(this.lockedPosition);
          this.node.computeWorldMatrix(true);
        }
        
        const hasLOS = this.hasLineOfSight();
        
        // LOCK POSITION again immediately after line of sight check
        if (this.lockedPosition) {
          this.node.position.copyFrom(this.lockedPosition);
          this.node.computeWorldMatrix(true);
        }
        
        if (hasLOS) {
          // Start rushing
          this.isRushing = true;
          this.isVisible = true;
        } else {
          // Go invisible
          this.hideFigure();
        }
      }
    }

    // Handle rushing
    if (this.isRushing) {
      this.rushTowardPlayer(deltaTime);
    }
  }

  private spawnFigure(): void {
    if (!this.playerNode) return;
    
    // Get camera position for spawn calculation
    const camera = this.scene.activeCamera;
    const spawnOrigin = camera ? camera.position : this.playerNode.position;
    
    console.log(`Attempting to spawn. Total wooden floor tiles: ${this.floorTiles.length}`);

    // Find a random floor tile at appropriate distance (0.01-0.1 units for testing)
    const validTiles: TransformNode[] = [];
    for (const tile of this.floorTiles) {
      const distance = Vector3.Distance(tile.position, spawnOrigin);
      console.log(`  Floor ${tile.name} is ${distance.toFixed(2)} units away from camera`);
      if (distance >= 0.01 && distance <= 0.1) {
        validTiles.push(tile);
        console.log(`    -> Valid spawn location!`);
      }
    }

    console.log(`Found ${validTiles.length} valid floor spawn locations`);

    if (validTiles.length === 0) {
      // Fallback: spawn at 0.05 units from camera in random direction at GROUND LEVEL
      const angle = Math.random() * Math.PI * 2;
      const x = spawnOrigin.x + Math.cos(angle) * 0.05;
      const z = spawnOrigin.z + Math.sin(angle) * 0.05;
      this.node.position = new Vector3(x, 1, z); // Always spawn at y=1 (ground level)
      console.log("No valid floors found - spawned at fallback position 0.05 units away from camera at ground level");
    } else {
      // Pick random valid tile
      const randomTile = validTiles[Math.floor(Math.random() * validTiles.length)];
      this.node.position = randomTile.position.clone();
      this.node.position.y = 1; // Always spawn at y=1 (ground level)
      const spawnDist = Vector3.Distance(this.node.position, spawnOrigin);
      console.log(`SUCCESS: Spawned on wooden floor "${randomTile.name}" at ${spawnDist.toFixed(1)} units away from camera at ground level`);
    }

    // Make visible
    this.node.setEnabled(true);
    this.isVisible = true;
    this.visibilityTimer = 0;
    
    // LOCK THE POSITION - save it so we can force it to stay here
    this.lockedPosition = this.node.position.clone();

    // Set next spawn time
    this.nextSpawnTime = this.spawnMinTime + Math.random() * (this.spawnMaxTime - this.spawnMinTime);

    // Face player
    this.facePlayer();
    
    console.log("Figure spawned and position LOCKED at:", this.lockedPosition);
  }

  private hideFigure(): void {
    this.node.setEnabled(false);
    this.isVisible = false;
    this.visibilityTimer = 0;
    this.lockedPosition = null;
  }

  private facePlayer(): void {
    if (!this.playerNode) return;

    const direction = this.playerNode.position.subtract(this.node.position);
    direction.y = 0;
    direction.normalize();

    const angle = Math.atan2(direction.x, direction.z);
    this.node.rotation.y = angle;
  }

  private hasLineOfSight(): boolean {
    // TEMPORARILY: Always return true for testing
    console.log("Line of sight check: ALWAYS TRUE (testing mode)");
    return true;
  }

  private rushTowardPlayer(deltaTime: number): void {
    if (!this.playerNode) return;

    // Get the camera position instead of player position for better targeting
    const camera = this.scene.activeCamera;
    const targetPosition = camera ? camera.position : this.playerNode.position;

    const direction = targetPosition.subtract(this.node.position);
    const distance = direction.length();

    console.log(`Rushing: distance to camera = ${distance.toFixed(2)}`);

    // Check if reached player
    if (distance <= this.jumpscareDistance) {
      console.log("Jumpscare triggered!");
      this.triggerJumpscare();
      return;
    }

    direction.normalize();

    // Move toward player (another 80% slower = 20% of current = 0.04 of original)
    const movement = direction.scale(this.rushSpeed * 0.04 * (deltaTime / 1000));
    this.node.position.addInPlace(movement);
  }

  private triggerJumpscare(): void {
    if (this.isJumpscaring || !this.playerNode) return;

    console.log("Jumpscare function called");
    this.isJumpscaring = true;
    this.isRushing = false;

    // Get the player's MovementController to disable it
    const movementController = this.playerNode.behaviors.find(b => b.name === "MovementController");
    if (movementController) {
      console.log("Disabling MovementController");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (movementController as any).enabled = false;
    }

    // Face player camera toward figure
    const camera = this.scene.activeCamera;
    if (camera && 'rotation' in camera) {
      const direction = this.node.position.subtract(camera.position);
      direction.y = 0;
      direction.normalize();
      const angle = Math.atan2(direction.x, direction.z);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (camera as any).rotation.y = angle;
      console.log("Camera rotated toward figure");
    }

    // Reset after 1 second
    console.log("Starting 1 second timer for reset");
    setTimeout(() => {
      console.log("Timer complete, resetting game");
      this.resetGame();
    }, 1000);
  }

  private resetGame(): void {
    console.log("Reset game called");
    
    // Respawn player
    if (this.playerNode) {
      this.playerNode.position = this.playerStartPosition.clone();
      
      // Re-enable MovementController
      const movementController = this.playerNode.behaviors.find(b => b.name === "MovementController");
      if (movementController) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (movementController as any).enabled = true;
      }
      
      console.log("Player respawned at start position");
    }

    // Hide figure
    this.hideFigure();

    // Reset state
    this.hasPlayerMoved = false;
    this.gameStarted = false;
    this.isRushing = false;
    this.isJumpscaring = false;
    this.spawnTimer = 0;
    this.visibilityTimer = 0;
    
    console.log("Game state reset complete");
  }

  protected onDetach(): void {
    // Cleanup
  }
}
