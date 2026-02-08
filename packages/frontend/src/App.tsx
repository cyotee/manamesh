import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { Client } from "boardgame.io/react";
import { Local } from "boardgame.io/multiplayer";
import { SimpleCardGame } from "./game/game";
import { GameBoard } from "./components/GameBoard";
import { GameSelector } from "./components/GameSelector";
import { PokerBoard } from "./components/PokerBoard";
import { WarBoard } from "./components/WarBoard";
import { MerkleBattleshipBoard } from "./components/MerkleBattleshipBoard";
import { ThresholdTallyBoard } from "./components/ThresholdTallyBoard";
import { GoFishBoard } from "./components/GoFishBoard";
import { OnePiecePhaserBoard } from "./components/OnePiecePhaserBoard";
import { P2PLobby, type P2PRole } from "./components/P2PLobby";
import { startP2P, P2PMultiplayer, type JoinCodeConnection } from "./p2p";
import { GAMES, getGameById, type GameInfo } from "./game/registry";
import { getBlockchainService, WalletContextProvider } from "./blockchain";
import { WalletProvider } from "./wallet";
import type { PokerHandResult } from "./game/modules/poker/types";
import { createCryptoInitialState } from "./game/modules/poker/crypto";

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[ManaMesh] Uncaught render error", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 24,
            maxWidth: 900,
            margin: "0 auto",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
            color: "#e4e4e4",
          }}
        >
          <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>
            ManaMesh failed to render
          </h1>
          <div style={{ opacity: 0.9, marginBottom: 12 }}>
            Open DevTools Console for full details.
          </div>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "rgba(0,0,0,0.35)",
              border: "1px solid #3a3a5c",
              borderRadius: 8,
              padding: 12,
              overflow: "auto",
            }}
          >
            {String(this.state.error?.stack || this.state.error?.message)}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

type GameMode = "gameSelect" | "modeSelect" | "local" | "online" | "p2p-game";

interface ModeSelectProps {
  game: GameInfo;
  onSelectMode: (mode: "local" | "online") => void;
  onBack: () => void;
}

const ModeSelect: React.FC<ModeSelectProps> = ({
  game,
  onSelectMode,
  onBack,
}) => {
  return (
    <div
      style={{
        padding: "40px",
        maxWidth: "600px",
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
      }}
    >
      <button
        onClick={onBack}
        style={{
          position: "absolute",
          top: "20px",
          left: "20px",
          padding: "8px 16px",
          cursor: "pointer",
          backgroundColor: "#3a3a5c",
          color: "#e4e4e4",
          border: "none",
          borderRadius: "4px",
        }}
      >
        ← Back
      </button>

      <h1 style={{ marginBottom: "8px", color: "#e4e4e4" }}>{game.name}</h1>
      <p style={{ color: "#a0a0a0", marginBottom: "40px" }}>
        {game.description}
      </p>

      <div
        style={{
          backgroundColor: "#16213e",
          padding: "32px",
          borderRadius: "12px",
          marginBottom: "20px",
          border: "1px solid #3a3a5c",
        }}
      >
        <h2 style={{ marginBottom: "24px", color: "#e4e4e4" }}>
          Choose Play Mode
        </h2>

        <button
          onClick={() => onSelectMode("local")}
          style={{
            padding: "16px 32px",
            fontSize: "18px",
            cursor: "pointer",
            backgroundColor: "#4CAF50",
            color: "white",
            border: "none",
            borderRadius: "8px",
            width: "100%",
            marginBottom: "16px",
          }}
        >
          Local Hotseat ({game.minPlayers}-{game.maxPlayers} Players)
        </button>

        <button
          onClick={() => onSelectMode("online")}
          style={{
            padding: "16px 32px",
            fontSize: "18px",
            cursor: "pointer",
            backgroundColor: "#2196F3",
            color: "white",
            border: "none",
            borderRadius: "8px",
            width: "100%",
          }}
        >
          P2P Online (No Server!)
        </button>
      </div>

      <div
        style={{
          backgroundColor: "#0f3460",
          padding: "16px",
          borderRadius: "8px",
          fontSize: "14px",
          textAlign: "left",
          color: "#c0d0e0",
          border: "1px solid #3a3a5c",
        }}
      >
        <strong>Players:</strong>{" "}
        {game.minPlayers === game.maxPlayers
          ? `${game.minPlayers} players`
          : `${game.minPlayers}-${game.maxPlayers} players`}
      </div>
    </div>
  );
};

// Get the appropriate board component for a game
// For poker, we need to wrap it to inject the onNewHand callback
function getBoardComponent(
  gameId: string,
  onNewHand?: (handResult: PokerHandResult) => void,
  p2pConnection?: JoinCodeConnection,
) {
  switch (gameId) {
    case "threshold-tally":
      // Wrap to inject p2p connection when in P2P mode
      if (p2pConnection) {
        const WrappedThresholdTallyBoard: React.FC<any> = (props) => (
          <ThresholdTallyBoard {...props} p2pConnection={p2pConnection} />
        );
        return WrappedThresholdTallyBoard;
      }
      return ThresholdTallyBoard;
    case "merkle-battleship":
      // Wrap to inject p2p connection when in P2P mode
      if (p2pConnection) {
        const WrappedMerkleBattleshipBoard: React.FC<any> = (props) => (
          <MerkleBattleshipBoard {...props} p2pConnection={p2pConnection} />
        );
        return WrappedMerkleBattleshipBoard;
      }
      return MerkleBattleshipBoard;
    case "poker":
      // Wrap PokerBoard to inject onNewHand callback
      if (onNewHand) {
        const WrappedPokerBoard: React.FC<any> = (props) => (
          <PokerBoard {...props} onNewHand={onNewHand} />
        );
        return WrappedPokerBoard;
      }
      return PokerBoard;
    case "war":
      return WarBoard;
    case "gofish":
    case "gofish-secure":
    case "gofish-zk":
      return GoFishBoard;
    case "onepiece":
      return OnePiecePhaserBoard;
    case "simple":
    default:
      return GameBoard;
  }
}

interface LocalGameProps {
  game: GameInfo;
  onBack: () => void;
}

const LocalGame: React.FC<LocalGameProps> = ({ game, onBack }) => {
  const [activePlayer, setActivePlayer] = useState<string>("0");
  const [numPlayers, setNumPlayers] = useState<number>(game.minPlayers);
  // Hand counter - incrementing this recreates the game
  const [handNumber, setHandNumber] = useState(0);
  // Dealer position rotates each hand
  const [dealerIndex, setDealerIndex] = useState(0);
  // Track if we're settling (to prevent double-clicks)
  const [isSettling, setIsSettling] = useState(false);

  // Get blockchain service
  const blockchainService = useMemo(() => getBlockchainService(), []);

  // Handle new hand request - settle pot and recreate game
  const handleNewHand = useCallback(
    async (handResult: PokerHandResult) => {
      if (isSettling) return;
      setIsSettling(true);

      try {
        console.log("[LocalGame] Settling hand:", handResult);

        // Settle the pot via blockchain service
        const settlementResult = await blockchainService.settlePot(handResult);

        if (settlementResult.success) {
          console.log(
            "[LocalGame] Settlement complete, new balances:",
            settlementResult.newBalances,
          );

          // Rotate dealer and increment hand number to trigger new game
          setDealerIndex((prev) => prev + 1);
          setHandNumber((prev) => prev + 1);
        } else {
          console.error(
            "[LocalGame] Settlement failed:",
            settlementResult.error,
          );
          alert(`Settlement failed: ${settlementResult.error}`);
        }
      } catch (error) {
        console.error("[LocalGame] Settlement error:", error);
        alert(`Settlement error: ${error}`);
      } finally {
        setIsSettling(false);
      }
    },
    [blockchainService, isSettling],
  );

  // Create a single Local multiplayer instance shared by both clients
  // Recreate when handNumber changes to start a fresh game
  const localMultiplayer = useMemo(() => Local(), [handNumber]);

  const playerIDs = useMemo(
    () => Array.from({ length: numPlayers }, (_, i) => String(i)),
    [numPlayers],
  );

  // If player count changes, start a fresh match.
  useEffect(() => {
    setHandNumber(0);
    setDealerIndex(0);
  }, [numPlayers]);

  // Keep activePlayer valid when numPlayers changes.
  useEffect(() => {
    if (!playerIDs.includes(activePlayer)) {
      setActivePlayer(playerIDs[0] ?? "0");
    }
  }, [activePlayer, playerIDs]);

  // Get initial balances from blockchain service
  const [initialBalances, setInitialBalances] = useState<
    Record<string, number>
  >({});

  // Only fetch initial balances on mount - subsequent updates come from settlement
  useEffect(() => {
    blockchainService.getBalances(playerIDs).then(setInitialBalances);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockchainService, playerIDs]);

  // Generate unique hand ID (regenerate each hand)
  const handId = useMemo(
    () => blockchainService.generateHandId(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blockchainService, handNumber],
  );

  // Get the game with options for blockchain integration
  const gameWithOptions = useMemo(() => {
    // For poker, use the crypto-enabled game with mental poker phases
    if (game.id === "poker" && game.getCryptoGame) {
      const cryptoGame = game.getCryptoGame();
      return {
        ...cryptoGame,
        setup: (ctx: any) => {
          // Call original setup but pass options
          const config = {
            numPlayers: ctx.numPlayers ?? numPlayers,
            playerIDs: ctx.playOrder ?? playerIDs,
            options: {
              initialBalances,
              handId,
              dealerIndex: dealerIndex % numPlayers,
            },
          };
          // Use imported createCryptoInitialState
          return createCryptoInitialState(config);
        },
      };
    }

    return game.getGame();
  }, [game, initialBalances, handId, dealerIndex, numPlayers, playerIDs]);

  // Create separate client instances for each player, sharing the same Local transport
  const clients = useMemo(() => {
    return playerIDs.map((pid) => ({
      pid,
      Client: Client({
        game: gameWithOptions,
        board: getBoardComponent(game.id, handleNewHand),
        multiplayer: localMultiplayer,
      }),
    }));
  }, [playerIDs, gameWithOptions, game.id, localMultiplayer, handleNewHand]);

  return (
    <div>
      <div
        style={{
          padding: "12px 20px",
          backgroundColor: "#16213e",
          color: "#e4e4e4",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #3a3a5c",
          position: "relative",
          zIndex: 100,
        }}
      >
        <button
          onClick={onBack}
          style={{
            padding: "8px 16px",
            cursor: "pointer",
            backgroundColor: "#3a3a5c",
            color: "#e4e4e4",
            border: "none",
            borderRadius: "4px",
          }}
        >
          ← Back to Lobby
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "12px", color: "#6b7280" }}>
            Hand #{handNumber + 1}
          </span>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#a0a0a0", fontSize: 12 }}>Players</span>
            <select
              value={numPlayers}
              onChange={(e) => setNumPlayers(Number(e.target.value))}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #3a3a5c",
                backgroundColor: "#0f172a",
                color: "#e4e4e4",
              }}
            >
              {Array.from(
                { length: game.maxPlayers - game.minPlayers + 1 },
                (_, i) => game.minPlayers + i,
              ).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span style={{ marginRight: "12px" }}>Viewing as:</span>
          {playerIDs.map((pid) => (
            <button
              key={pid}
              onClick={() => setActivePlayer(pid)}
              style={{
                padding: "8px 16px",
                cursor: "pointer",
                backgroundColor: activePlayer === pid ? "#4CAF50" : "#3a3a5c",
                color: "#e4e4e4",
                border: "none",
                borderRadius: "4px",
              }}
            >
              Player {pid}
            </button>
          ))}
        </div>
      </div>
      {/* Settling overlay */}
      {isSettling && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: "#16213e",
              padding: "32px",
              borderRadius: "12px",
              textAlign: "center",
              color: "#e4e4e4",
            }}
          >
            <div style={{ fontSize: "24px", marginBottom: "16px" }}>⏳</div>
            <div>Settling pot on blockchain...</div>
          </div>
        </div>
      )}
      {/* Render all clients but only show the active one */}
      {clients.map(({ pid, Client: GameClient }) => (
        <div
          key={pid}
          style={{ display: activePlayer === pid ? "block" : "none" }}
        >
          <GameClient playerID={pid} matchID={`local-match-${handNumber}`} />
        </div>
      ))}
    </div>
  );
};

// P2P Game component - uses boardgame.io with P2P transport
interface P2PGameProps {
  game: GameInfo;
  connection: JoinCodeConnection;
  role: P2PRole;
  onBack: () => void;
}

const P2PGame: React.FC<P2PGameProps> = ({
  game,
  connection,
  role,
  onBack,
}) => {
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "disconnected" | "reconnecting"
  >("connected");
  // Hand counter - incrementing this recreates the game
  const [handNumber, setHandNumber] = useState(0);
  // Dealer position rotates each hand
  const [dealerIndex, setDealerIndex] = useState(0);
  // Track if we're settling
  const [isSettling, setIsSettling] = useState(false);
  // Track if the P2P client has been created for this hand to prevent recreation
  const clientCreatedForHandRef = useRef<number>(-1);

  // Get blockchain service
  const blockchainService = useMemo(() => getBlockchainService(), []);

  // Handle new hand request - settle pot and signal new game
  const handleNewHand = useCallback(
    async (handResult: PokerHandResult) => {
      if (isSettling) return;

      // Only host can initiate new hand in P2P mode
      if (role !== "host") {
        console.log("[P2PGame] Only host can start new hand");
        return;
      }

      setIsSettling(true);

      try {
        console.log("[P2PGame] Settling hand:", handResult);

        // Settle the pot via blockchain service
        const settlementResult = await blockchainService.settlePot(handResult);

        if (settlementResult.success) {
          console.log(
            "[P2PGame] Settlement complete, new balances:",
            settlementResult.newBalances,
          );

          // Signal new game to peer via P2P connection
          // The peer will receive this and also recreate their game
          const newHandSignal = {
            type: "new-hand",
            handNumber: handNumber + 1,
            dealerIndex: dealerIndex + 1,
            balances: settlementResult.newBalances,
          };

          // Send signal via P2P data channel
          if ((connection as any).sendSignal) {
            (connection as any).sendSignal(newHandSignal);
          }

          // Update HOST's own balances from settlement result
          if (settlementResult.newBalances) {
            setInitialBalances(settlementResult.newBalances);
          }

          // Rotate dealer and increment hand number
          setDealerIndex((prev) => prev + 1);
          setHandNumber((prev) => prev + 1);
        } else {
          console.error("[P2PGame] Settlement failed:", settlementResult.error);
          alert(`Settlement failed: ${settlementResult.error}`);
        }
      } catch (error) {
        console.error("[P2PGame] Settlement error:", error);
        alert(`Settlement error: ${error}`);
      } finally {
        setIsSettling(false);
      }
    },
    [blockchainService, isSettling, role, connection, handNumber, dealerIndex],
  );

  // Listen for new hand signals from host (if we're the guest)
  useEffect(() => {
    if (role !== "guest") return;

    const handleSignal = (signal: any) => {
      if (signal.type === "new-hand") {
        console.log("[P2PGame] Received new hand signal:", signal);
        // Update balances from the signal (these come from HOST's settlement)
        if (signal.balances) {
          setInitialBalances(signal.balances);
        }
        setHandNumber(signal.handNumber);
        setDealerIndex(signal.dealerIndex);
      }
    };

    // Register signal handler
    if ((connection as any).onSignal) {
      (connection as any).onSignal(handleSignal);
    }

    return () => {
      // Cleanup signal handler
      if ((connection as any).offSignal) {
        (connection as any).offSignal(handleSignal);
      }
    };
  }, [connection, role]);

  // Get initial balances from blockchain service
  // Only fetch on mount - subsequent updates come from settlement (HOST) or signals (GUEST)
  const [initialBalances, setInitialBalances] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    blockchainService.getBalances(["0", "1"]).then(setInitialBalances);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockchainService]);

  // Generate unique hand ID (regenerate each hand)
  const handId = useMemo(
    () => blockchainService.generateHandId(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blockchainService, handNumber],
  );

  // Monitor connection state
  useEffect(() => {
    const events = (connection as any).events;
    if (!events) return;

    const originalOnConnectionStateChange = events.onConnectionStateChange;

    events.onConnectionStateChange = (state: string) => {
      if (state === "connected") {
        setConnectionStatus("connected");
      } else if (state === "disconnected") {
        setConnectionStatus("reconnecting");
      } else if (state === "failed") {
        setConnectionStatus("disconnected");
      }
      originalOnConnectionStateChange?.(state);
    };

    return () => {
      events.onConnectionStateChange = originalOnConnectionStateChange;
    };
  }, [connection]);

  const playerID = role === "host" ? "0" : "1";

  // Store the initial balances at the time of client creation
  // This prevents client recreation when balances update asynchronously
  const initialBalancesForHandRef = useRef<Record<string, number>>({});

  // Create the P2P client dynamically based on role
  // Use crypto-enabled game for P2P mode (if available)
  // IMPORTANT: Only recreate when handNumber changes, not when initialBalances changes
  const P2PClient = useMemo(() => {
    // Skip recreation if we already created a client for this hand
    // This prevents the async balance fetch from causing recreation mid-game
    if (clientCreatedForHandRef.current === handNumber) {
      console.log("[P2PGame] Skipping client recreation for hand", handNumber);
      // Return a dummy that won't be used since we already have the real client
      return null;
    }

    // Mark this hand as having a client created
    clientCreatedForHandRef.current = handNumber;

    // Capture the current balances for this hand
    // Use current initialBalances if available, otherwise default to 1000 each
    const balancesForThisHand =
      Object.keys(initialBalances).length > 0
        ? initialBalances
        : { "0": 1000, "1": 1000 };
    initialBalancesForHandRef.current = balancesForThisHand;

    console.log(
      "[P2PGame] Creating P2P client for hand",
      handNumber,
      "with balances",
      balancesForThisHand,
    );

    // Prefer crypto game for P2P mode for cryptographic fairness
    let gameDefinition = game.getCryptoGame
      ? game.getCryptoGame()
      : game.getGame();

    // For poker, inject initial balances
    if (game.id === "poker") {
      gameDefinition = {
        ...gameDefinition,
        setup: (ctx: any) => {
          const config = {
            numPlayers: ctx.numPlayers ?? 2,
            playerIDs: ctx.playOrder ?? ["0", "1"],
            options: {
              initialBalances: initialBalancesForHandRef.current,
              handId,
              dealerIndex: dealerIndex % 2,
            },
          };
          return createCryptoInitialState(config);
        },
      };
    }

    return Client({
      game: gameDefinition,
      board: getBoardComponent(
        game.id,
        role === "host" ? handleNewHand : undefined,
        connection,
      ),
      multiplayer: P2PMultiplayer({
        connection,
        role,
        playerID,
        matchID: `p2p-match-${handNumber}`,
        numPlayers: 2,
      }),
      debug: false,
    });
    // NOTE: We intentionally exclude initialBalances from deps to prevent recreation
    // when the async balance fetch completes. We capture balances at creation time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, role, game, handNumber, handId, dealerIndex, playerID]);

  // Keep a stable reference to the client
  const stableClientRef = useRef<typeof P2PClient>(null);
  if (P2PClient !== null) {
    stableClientRef.current = P2PClient;
  }
  const StableP2PClient = stableClientRef.current;

  return (
    <div>
      <div
        style={{
          padding: "12px 20px",
          backgroundColor: "#16213e",
          color: "#e4e4e4",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #3a3a5c",
        }}
      >
        <button
          onClick={onBack}
          style={{
            padding: "8px 16px",
            cursor: "pointer",
            backgroundColor: "#3a3a5c",
            color: "#e4e4e4",
            border: "none",
            borderRadius: "4px",
          }}
        >
          ← Disconnect
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "12px", color: "#6b7280" }}>
            Hand #{handNumber + 1}
          </span>
          <span
            style={{
              padding: "4px 12px",
              backgroundColor: role === "host" ? "#4CAF50" : "#2196F3",
              borderRadius: "4px",
              fontSize: "12px",
              textTransform: "uppercase",
            }}
          >
            {role}
          </span>
          <span
            style={{
              color:
                connectionStatus === "connected"
                  ? "#6fcf6f"
                  : connectionStatus === "reconnecting"
                    ? "#ff9800"
                    : "#ff6b6b",
            }}
          >
            {connectionStatus === "connected"
              ? "● Connected via P2P"
              : connectionStatus === "reconnecting"
                ? "○ Reconnecting..."
                : "○ Disconnected"}
          </span>
        </div>
      </div>
      {/* Settling overlay */}
      {isSettling && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: "#16213e",
              padding: "32px",
              borderRadius: "12px",
              textAlign: "center",
              color: "#e4e4e4",
            }}
          >
            <div style={{ fontSize: "24px", marginBottom: "16px" }}>⏳</div>
            <div>Settling pot on blockchain...</div>
          </div>
        </div>
      )}
      {StableP2PClient && (
        <StableP2PClient
          playerID={playerID}
          matchID={`p2p-match-${handNumber}`}
        />
      )}
    </div>
  );
};

const AppContent: React.FC = () => {
  const [gameMode, setGameMode] = useState<GameMode>("gameSelect");
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [p2pConnection, setP2pConnection] = useState<JoinCodeConnection | null>(
    null,
  );
  const [p2pRole, setP2pRole] = useState<P2PRole>("host");

  const selectedGame = selectedGameId ? getGameById(selectedGameId) : null;

  useEffect(() => {
    // Initialize P2P in background
    startP2P();
  }, []);

  const handleSelectGame = useCallback((gameId: string) => {
    setSelectedGameId(gameId);
    setGameMode("modeSelect");
  }, []);

  const handleSelectMode = useCallback((mode: "local" | "online") => {
    setGameMode(mode);
  }, []);

  const handleBackToGameSelect = useCallback(() => {
    setSelectedGameId(null);
    setGameMode("gameSelect");
  }, []);

  const handleBackToModeSelect = useCallback(() => {
    setGameMode("modeSelect");
  }, []);

  const handleP2PConnected = useCallback(
    (connection: JoinCodeConnection, role: P2PRole) => {
      setP2pConnection(connection);
      setP2pRole(role);
      setGameMode("p2p-game");
    },
    [],
  );

  const handleBackFromP2P = useCallback(() => {
    p2pConnection?.close();
    setP2pConnection(null);
    setGameMode("modeSelect");
  }, [p2pConnection]);

  // Game selection screen
  if (gameMode === "gameSelect") {
    return <GameSelector onSelectGame={handleSelectGame} />;
  }

  // Mode selection screen
  if (gameMode === "modeSelect" && selectedGame) {
    return (
      <ModeSelect
        game={selectedGame}
        onSelectMode={handleSelectMode}
        onBack={handleBackToGameSelect}
      />
    );
  }

  // Local game
  if (gameMode === "local" && selectedGame) {
    return <LocalGame game={selectedGame} onBack={handleBackToModeSelect} />;
  }

  // P2P lobby
  if (gameMode === "online") {
    return (
      <P2PLobby
        onConnected={handleP2PConnected}
        onBack={handleBackToModeSelect}
      />
    );
  }

  // P2P game
  if (gameMode === "p2p-game" && p2pConnection && selectedGame) {
    return (
      <P2PGame
        game={selectedGame}
        connection={p2pConnection}
        role={p2pRole}
        onBack={handleBackFromP2P}
      />
    );
  }

  // Fallback to game selection
  return <GameSelector onSelectGame={handleSelectGame} />;
};

/**
 * App component wrapped with WalletProvider (real wallet stack).
 *
 * In DEV, also wraps with the legacy WalletContextProvider to keep mock-wallet
 * demos/tests working without a real extension.
 */
const App: React.FC = () => {
  // Helps diagnose "blank page" issues in dev.
  if (import.meta.env.DEV) {
    console.log("[ManaMesh] <App /> render");
  }

  return (
    <AppErrorBoundary>
      <WalletProvider>
        {import.meta.env.DEV ? (
          <WalletContextProvider>
            <AppContent />
          </WalletContextProvider>
        ) : (
          <AppContent />
        )}
      </WalletProvider>
    </AppErrorBoundary>
  );
};

export default App;
