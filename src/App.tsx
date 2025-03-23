import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getDatabase, 
  ref, 
  onValue, 
  set, 
  push, 
  update, 
  remove, 
  onDisconnect, 
  serverTimestamp,
} from 'firebase/database';
import './App.css';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Define types for our data model
interface User {
  id: string;
  name: string;
  color: string;
  lastActive: object | null;
}

interface Card {
  id: string;
  value: number;
  selected: boolean;
  selectedBy: string | null;
}

interface CardHistory {
  id: string;
  originalValue: number;
  isRemoved: boolean;
}

interface GameState {
  cards: { [key: string]: Card };
  selectedCardId: string | null;
  currentOperation: Operation | null;
  gameActive: boolean;
  lastReset: object | null;
  thinkingMode?: boolean;
  thinkingUserId?: string | null;
  thinkingUserName?: string | null;
  timerEndTime: number | null; // Timestamp when the timer should end
  thinkingEndTime: number | null; // Timestamp when thinking time should end
  cardHistory: CardHistory[]; // Track original cards and their values
  gameWon: boolean; // Track if game has been won
}

interface Users {
  [key: string]: User;
}

// Define operation type
type Operation = 'add' | 'subtract' | 'multiply' | 'divide' | null;

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [username, setUsername] = useState<string>('');
  const [userColor, setUserColor] = useState<string>('#' + Math.floor(Math.random()*16777215).toString(16));
  const [onlineUsers, setOnlineUsers] = useState<Users>({});
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [localSelectedCard, setLocalSelectedCard] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState<boolean>(true);
  const [debugMessages, setDebugMessages] = useState<string[]>([]);
  const [resetTimerId, setResetTimerId] = useState<NodeJS.Timeout | null>(null);
  const [timeUntilReset, setTimeUntilReset] = useState<number>(30);
  const [thinkingTimeLeft, setThinkingTimeLeft] = useState<number>(10);
  const [thinkingTimerId, setThinkingTimerId] = useState<NodeJS.Timeout | null>(null);
  const [savedTimeUntilReset, setSavedTimeUntilReset] = useState<number>(30);

  // Add this function to handle thinking time
  const startThinkingTime = (): void => {
    if (!currentUser || !gameState || !gameState.gameActive) return;
    if (gameState.thinkingMode) return;
    
    debugLog(`${currentUser.name} started thinking time (10 seconds)`);
    
    // Calculate end times based on server time + durations
    const now = Date.now();
    const thinkingEndTime = now + 10000; // 10 seconds
    
    // Save the current game timer remaining time before pausing
    const remainingGameTime = gameState.timerEndTime ? 
      Math.max(0, Math.ceil((gameState.timerEndTime - now) / 1000)) : 
      30;
    
    setSavedTimeUntilReset(remainingGameTime);
    
    // Update Firebase first
    update(ref(database, 'gameState'), { 
      thinkingMode: true,
      thinkingUserId: currentUser.id,
      thinkingUserName: currentUser.name,
      thinkingEndTime: thinkingEndTime
    }).then(() => {
      debugLog("Thinking mode activated");
      setThinkingTimeLeft(10);
    }).catch(error => debugLog(`Error activating thinking mode: ${error.message}`));
  };

  const endThinkingTime = (): void => {
    if (!currentUser || !gameState) return;
    
    debugLog("Ending thinking time");
    
    // Clear thinking timer
    if (thinkingTimerId) {
      clearInterval(thinkingTimerId);
      setThinkingTimerId(null);
    }
    
    // Check if player succeeded (one card with value 24)
    const remainingCards = Object.values(gameState.cards);
    const succeeded = remainingCards.length === 1 && Math.abs(remainingCards[0].value - 24) < 0.001;
    
    if (succeeded) {
      // Player succeeded - end game
      debugLog("Player succeeded! Value is 24");
      update(ref(database, 'gameState'), { 
        thinkingMode: false,
        thinkingUserId: null,
        thinkingUserName: null,
        thinkingEndTime: null,
        gameActive: false,
        gameWon: true
      }).then(() => {
        debugLog("Game won!");
      }).catch(error => debugLog(`Error updating game state: ${error.message}`));
    } else {
      // Player failed - reset cards to original state
      debugLog("Player failed to make 24. Resetting cards.");
      resetCardsToOriginal();
      
      // Calculate new game timer end time based on saved time
      const now = Date.now();
      const newTimerEndTime = now + (savedTimeUntilReset * 1000);
      
      // Update Firebase
      update(ref(database, 'gameState'), { 
        thinkingMode: false,
        thinkingUserId: null,
        thinkingUserName: null,
        thinkingEndTime: null,
        timerEndTime: newTimerEndTime
      }).then(() => {
        debugLog("Thinking mode deactivated, game timer restarted");
      }).catch(error => debugLog(`Error deactivating thinking mode: ${error.message}`));
    }
  };

  const resetCardsToOriginal = (): void => {
    if (!gameState) return;
    
    debugLog("Resetting cards to original values");
    
    const newCards: { [key: string]: Card } = {};
    
    // Recreate all cards with original values
    gameState.cardHistory.forEach(historyCard => {
      newCards[historyCard.id] = {
        id: historyCard.id,
        value: historyCard.originalValue,
        selected: false,
        selectedBy: null
      };
    });
    
    // Update Firebase with reset cards
    update(ref(database, 'gameState'), {
      cards: newCards,
      selectedCardId: null,
      currentOperation: null
    }).then(() => {
      debugLog("Cards reset to original values");
    }).catch(error => debugLog(`Error resetting cards: ${error.message}`));
  };

  const isCardRemoved = (cardId: string): boolean => {
    if (!gameState || !gameState.cardHistory) return false;
    
    const historyCard = gameState.cardHistory.find(card => card.id === cardId);
    return historyCard ? historyCard.isRemoved : false;
  };

  useEffect(() => {
    // Skip if no game state or user yet
    if (!gameState || !currentUser) return;
  
    // Clean up on unmount or when game becomes inactive
    if (!gameState.gameActive) {
      if (resetTimerId) {
        clearInterval(resetTimerId);
        setResetTimerId(null);
      }
      if (thinkingTimerId) {
        clearInterval(thinkingTimerId);
        setThinkingTimerId(null);
      }
      return;
    }
  
    // Clear any existing timers
    if (resetTimerId) {
      clearInterval(resetTimerId);
      setResetTimerId(null);
    }
    if (thinkingTimerId) {
      clearInterval(thinkingTimerId);
      setThinkingTimerId(null);
    }
  
    // Start a single timer that updates both countdown displays
    const timerId = setInterval(() => {
      const now = Date.now();
      
      // Update game timer if not in thinking mode
      if (!gameState.thinkingMode && gameState.timerEndTime) {
        const secondsLeft = Math.max(0, Math.ceil((gameState.timerEndTime - now) / 1000));
        setTimeUntilReset(secondsLeft);
        
        // If timer expired, reset the game (but only do this once)
        if (secondsLeft === 0 && gameState.timerEndTime > now - 1000) {
          debugLog("Server timer expired - resetting game");
          resetGame();
        }
      }
      
      // Update thinking timer if in thinking mode
      if (gameState.thinkingMode && gameState.thinkingEndTime) {
        const thinkingSecondsLeft = Math.max(0, Math.ceil((gameState.thinkingEndTime - now) / 1000));
        setThinkingTimeLeft(thinkingSecondsLeft);
        
        // If thinking timer expired, end thinking time (but only do this once)
        if (thinkingSecondsLeft === 0 && gameState.thinkingEndTime > now - 1000) {
          debugLog("Thinking timer expired");
          if (gameState.thinkingUserId === currentUser.id) {
            endThinkingTime();
          }
        }
      }
    }, 200); // Check more frequently than 1 second to avoid missing expirations
    
    setResetTimerId(timerId);
  
    return () => {
      if (timerId) clearInterval(timerId);
    };
  }, [gameState, currentUser]);

  // Add this at the top of your component where other useEffect hooks are
  useEffect(() => {
    // Skip if no database connection yet
    if (!database) return;
    
    const usersRef = ref(database, 'users');
    debugLog("Setting up listener for user count");
    
    const unsubscribe = onValue(usersRef, (snapshot) => {
      // Check if users exist in the database
      if (!snapshot.exists() || Object.keys(snapshot.val()).length === 0) {
        debugLog("No users online, cleaning up game state");
        cleanupGameState();
      }
    });
    
    return () => {
      debugLog("Cleaning up user count listener");
      unsubscribe();
    };
  }, [database]);

  // Add this function to your component
  const cleanupGameState = (): void => {
    // Only proceed if database is initialized
    if (!database) return;
    
    debugLog("Performing cleanup: Removing game state");
    
    // Remove the entire game state
    remove(ref(database, 'gameState'))
      .then(() => debugLog("Game state removed successfully"))
      .catch(error => debugLog(`Error removing game state: ${error.message}`));
      
    // You could also reset instead of remove if you prefer
    // set(ref(database, 'gameState'), null)
    //   .then(() => debugLog("Game state reset"))
    //   .catch(error => debugLog(`Error resetting game state: ${error.message}`));
  };

  // Debug log function
  const debugLog = (message: string) => {
    if (debugMode) {
      console.log(message);
      setDebugMessages(prev => [message, ...prev].slice(0, 10));
    }
  };

  // Join collaboration session
  const joinCollaboration = (): void => {
    if (username.trim()) {
      const userId = 'user_' + Date.now();
      const user: User = {
        id: userId,
        name: username,
        color: userColor,
        lastActive: serverTimestamp()
      };
  
      debugLog(`Joining as ${username} with ID ${userId}`);
  
      // Save user to Firebase
      set(ref(database, `users/${userId}`), user)
        .then(() => {
          debugLog("User saved to Firebase");
          setCurrentUser(user);
          
          // Force immediate timer start
          debugLog("Forcing immediate timer start after joining");
          if (resetTimerId) {
            clearInterval(resetTimerId);
            setResetTimerId(null);
          }
          
          // Create a new timer immediately without waiting for useEffect
          const newTimerId = setInterval(() => {
            setTimeUntilReset(prevTime => {
              const newTime = prevTime - 1;
              if (newTime <= 0) {
                debugLog("Auto-reset timer triggered");
                resetGame();
                return 30;
              }
              return newTime;
            });
          }, 1000);
          
          setResetTimerId(newTimerId);
          setTimeUntilReset(30);
          debugLog("Immediate timer started with ID: " + newTimerId);
        })
        .catch(error => debugLog(`Error saving user: ${error.message}`));
      
      // Setup disconnect handler
      onDisconnect(ref(database, `users/${userId}`)).remove();
      
      // Check if game exists, if not initialize it
      const gameStateRef = ref(database, 'gameState');
      onValue(gameStateRef, (snapshot) => {
        if (!snapshot.exists()) {
          debugLog("No game state found, initializing new game");
          initializeGame();
        } else {
          debugLog("Existing game state found");
        }
      }, { onlyOnce: true });
    }
  };

  // Initialize game with 4 random cards
  const initializeGame = (): void => {
    const gameStateRef = ref(database, 'gameState');
    const cardsObj: { [key: string]: Card } = {};
    const cardHistory: CardHistory[] = [];
    
    // Generate cards as before
    for (let i = 0; i < 4; i++) {
      const cardId = `card_${i}`;
      const cardValue = Math.floor(Math.random() * 10) + 1; // 1-10
      
      cardsObj[cardId] = {
        id: cardId,
        value: cardValue,
        selected: false,
        selectedBy: null
      };
      
      // Add to card history
      cardHistory.push({
        id: cardId,
        originalValue: cardValue,
        isRemoved: false
      });
    }
    
    // Set timer end time 30 seconds from now
    const now = Date.now();
    const timerEndTime = now + 30000; // 30 seconds
    
    const initialGameState: GameState = {
      cards: cardsObj,
      selectedCardId: null,
      currentOperation: null,
      gameActive: true,
      lastReset: serverTimestamp(),
      thinkingMode: false,
      thinkingUserId: null,
      thinkingUserName: null,
      timerEndTime: timerEndTime,
      thinkingEndTime: null,
      cardHistory: cardHistory,
      gameWon: false
    };
    
    debugLog("Initializing new game with 4 cards");
    set(gameStateRef, initialGameState)
      .then(() => {
        debugLog("Game initialized successfully");
        setTimeUntilReset(30);
        setThinkingTimeLeft(10);
      })
      .catch(error => debugLog(`Error initializing game: ${error.message}`));
  };

  // Reset the game
  const resetGame = (): void => {
    if (currentUser) {
      debugLog("Resetting game");
      
      // Clear all timers
      if (resetTimerId) {
        clearInterval(resetTimerId);
        setResetTimerId(null);
      }
      if (thinkingTimerId) {
        clearInterval(thinkingTimerId);
        setThinkingTimerId(null);
      }
      
      // Reset timer states
      setTimeUntilReset(30);
      setThinkingTimeLeft(10);
      
      // Initialize new game
      initializeGame();
    }
  };

  // Handle card selection
  const handleCardClick = (cardId: string): void => {

    if (!currentUser || !gameState || !gameState.gameActive) {
      debugLog("Cannot select card: user not logged in or game not active");
      return;
    }
    
    // Check if thinking mode is active and user is not the thinking user
    if (!gameState.thinkingMode || gameState.thinkingUserId !== currentUser.id) {
      debugLog("Cannot select card: not in thinking mode or not your thinking turn");
      return;
    }
    
    // Log complete game state for debugging
    debugLog(`Card clicked: ${cardId}`);
    debugLog(`Current game state: selectedCardId=${gameState.selectedCardId}, operation=${gameState.currentOperation}, localSelectedCard=${localSelectedCard}`);
    debugLog(`Cards in game: ${Object.keys(gameState.cards).join(', ')}`);
    
    const card = gameState.cards[cardId];
    if (!card) {
      debugLog(`Card ${cardId} not found in game state`);
      return;
    }
    
    // Card is already selected by someone else
    if (card.selected && card.selectedBy && card.selectedBy !== currentUser.id) {
      debugLog(`Card ${cardId} already selected by user ${card.selectedBy}`);
      return;
    }
    
    // Check for inconsistent state and reset if needed
    if ((gameState.selectedCardId && !gameState.cards[gameState.selectedCardId]) || 
        (gameState.currentOperation && !gameState.selectedCardId)) {
      debugLog("Detected inconsistent game state, resetting selections");
      
      // Reset Firebase game state
      update(ref(database, 'gameState'), { 
        selectedCardId: null, 
        currentOperation: null 
      }).then(() => debugLog("Game state reset due to inconsistency"))
        .catch(error => debugLog(`Error resetting game state: ${error.message}`));
      
      setLocalSelectedCard(null);
      return;
    }
    
    // First card selection (no card currently selected)
    if (!gameState.selectedCardId) {
      debugLog(`Selecting first card: ${cardId}`);
      
      // Update card in Firebase
      update(ref(database, `gameState/cards/${cardId}`), {
        selected: true,
        selectedBy: currentUser.id
      }).then(() => debugLog("Card selection updated in Firebase"))
        .catch(error => debugLog(`Error updating card selection: ${error.message}`));
      
      // Update game state in Firebase
      update(ref(database, 'gameState'), { 
        selectedCardId: cardId 
      }).then(() => debugLog("Game state updated with selected card"))
        .catch(error => debugLog(`Error updating game state: ${error.message}`));
      
      setLocalSelectedCard(cardId);
    } 
    // Second card selection with operation
    else if (gameState.currentOperation && cardId !== gameState.selectedCardId) {
      // Second card selection (perform operation)
      debugLog(`Performing ${gameState.currentOperation} with cards ${gameState.selectedCardId} and ${cardId}`);
      
      // Call the operation function with null checks
      if (gameState.selectedCardId && cardId) {
        performOperation(gameState.selectedCardId, cardId, gameState.currentOperation);
      } else {
        debugLog("Cannot perform operation: missing card ID");
      }
    } 
    // Switching to a different card without operation
    else if (!gameState.currentOperation && cardId !== gameState.selectedCardId) {
      debugLog(`Switching selection to card: ${cardId}`);
      
      // Deselect the previous card
      if (gameState.selectedCardId) {
        update(ref(database, `gameState/cards/${gameState.selectedCardId}`), {
          selected: false,
          selectedBy: null
        }).then(() => debugLog("Previous card deselected"))
          .catch(error => debugLog(`Error deselecting previous card: ${error.message}`));
      }
      
      // Select the new card
      update(ref(database, `gameState/cards/${cardId}`), {
        selected: true,
        selectedBy: currentUser.id
      }).then(() => debugLog("New card selected"))
        .catch(error => debugLog(`Error selecting new card: ${error.message}`));
      
      // Update selected card in game state
      update(ref(database, 'gameState'), { 
        selectedCardId: cardId 
      }).then(() => debugLog("Game state updated with new selected card"))
        .catch(error => debugLog(`Error updating game state: ${error.message}`));
      
      setLocalSelectedCard(cardId);
    }
    // Deselect case
    else if (cardId === gameState.selectedCardId && card.selectedBy === currentUser.id) {
      // Deselect the card
      debugLog(`Deselecting card: ${cardId}`);
      
      // Update card in Firebase
      update(ref(database, `gameState/cards/${cardId}`), {
        selected: false,
        selectedBy: null
      }).then(() => debugLog("Card deselection updated in Firebase"))
        .catch(error => debugLog(`Error updating card deselection: ${error.message}`));
      
      // Update game state in Firebase
      update(ref(database, 'gameState'), { 
        selectedCardId: null, 
        currentOperation: null 
      }).then(() => debugLog("Game state updated with deselected card"))
        .catch(error => debugLog(`Error updating game state: ${error.message}`));
      
      setLocalSelectedCard(null);
    } else {
      debugLog(`Card click ignored: selectedCardId=${gameState.selectedCardId}, currentOperation=${gameState.currentOperation}`);
    }
  };

  // Handle operation selection
  const handleOperationClick = (operation: Operation): void => {
    if (!currentUser || !gameState || gameState.selectedCardId === null) {
      debugLog("Cannot select operation: no card selected");
      return;
    }
    
    // Only allow operation selection during thinking time of the current user
    if (!gameState.thinkingMode || gameState.thinkingUserId !== currentUser.id) {
      debugLog("Cannot select operation: not in thinking mode or not your thinking turn");
      return;
    }
    
    // Check if the selected card belongs to this user
    const selectedCard = gameState.cards[gameState.selectedCardId];
    if (!selectedCard || selectedCard.selectedBy !== currentUser.id) {
      debugLog("Cannot select operation: selected card doesn't belong to this user");
      return;
    }
    
    debugLog(`Selected operation: ${operation}`);
    update(ref(database, 'gameState'), { currentOperation: operation })
      .then(() => debugLog("Operation updated in Firebase"))
      .catch(error => debugLog(`Error updating operation: ${error.message}`));
  };

  // Perform operation between two cards
  const performOperation = (firstCardId: string, secondCardId: string, operation: Operation): void => {
    if (!currentUser || !gameState) {
      debugLog("Cannot perform operation: user not logged in or game state missing");
      return;
    }
    
    const firstCard = gameState.cards[firstCardId];
    const secondCard = gameState.cards[secondCardId];
    
    if (!firstCard || !secondCard) {
      debugLog("Cannot perform operation: one or both cards not found");
      return;
    }
    
    let result: number;
    
    switch(operation) {
      case 'add':
        result = firstCard.value + secondCard.value;
        break;
      case 'subtract':
        result = firstCard.value - secondCard.value;
        break;
      case 'multiply':
        result = firstCard.value * secondCard.value;
        break;
      case 'divide':
        // Prevent division by zero
        if (secondCard.value === 0) {
          debugLog("Cannot divide by zero");
          return;
        }
        result = firstCard.value / secondCard.value;
        // Round to 2 decimal places
        result = Math.round(result * 100) / 100;
        break;
      default:
        debugLog("Invalid operation");
        return;
    }
    
    debugLog(`Operation result: ${firstCard.value} ${operation} ${secondCard.value} = ${result}`);
    
    // Update the second card with the result, but keep it selected
    update(ref(database, `gameState/cards/${secondCardId}`), {
      value: result,
      selected: true,
      selectedBy: currentUser.id
    }).then(() => debugLog("Second card updated with result and remains selected"))
      .catch(error => debugLog(`Error updating second card: ${error.message}`));
    
    // Update card history - mark first card as removed
    const updatedHistory = gameState.cardHistory.map(card => {
      if (card.id === firstCardId) {
        return { ...card, isRemoved: true };
      }
      return card;
    });
    
    // Remove the first card but preserve its ID to maintain position
    remove(ref(database, `gameState/cards/${firstCardId}`))
      .then(() => debugLog("First card removed"))
      .catch(error => debugLog(`Error removing first card: ${error.message}`));
    
    // Reset operation but keep the second card selected
    update(ref(database, 'gameState'), { 
      selectedCardId: secondCardId,
      currentOperation: null,
      cardHistory: updatedHistory
    }).then(() => debugLog("Game state updated: operation reset, second card still selected"))
      .catch(error => debugLog(`Error updating game state: ${error.message}`));
    
    setLocalSelectedCard(secondCardId);
    
    // Check if game is won (only one card remains with value 24)
    const remainingCards = Object.values(gameState.cards).filter(c => c.id !== firstCardId);
    if (remainingCards.length === 1 && Math.abs(remainingCards[0].value - 24) < 0.001) {
      debugLog("Game won! Final card value is 24");
      update(ref(database, 'gameState'), { 
        gameActive: false,
        gameWon: true
      })
        .then(() => debugLog("Game state updated to won"))
        .catch(error => debugLog(`Error updating game state: ${error.message}`));
    }
  };

  // Listen for online users
  useEffect(() => {
    const usersRef = ref(database, 'users');
    debugLog("Setting up listener for online users");
    
    const unsubscribe = onValue(usersRef, (snapshot) => {
      if (snapshot.exists()) {
        const users = snapshot.val() as Users;
        setOnlineUsers(users);
        debugLog(`Online users updated: ${Object.keys(users).length} users`);
      } else {
        setOnlineUsers({});
        debugLog("No online users found");
      }
    });
    
    return () => {
      debugLog("Cleaning up online users listener");
      unsubscribe();
    };
  }, []);

  // Listen for game state changes
  useEffect(() => {
    const gameStateRef = ref(database, 'gameState');
    debugLog("Setting up listener for game state");
    
    const unsubscribe = onValue(gameStateRef, (snapshot) => {
      if (snapshot.exists()) {
        const state = snapshot.val() as GameState;
        setGameState(state);
        debugLog(`Game state updated: ${Object.keys(state.cards).length} cards, selectedCardId=${state.selectedCardId}`);
      } else {
        setGameState(null);
        debugLog("No game state found");
      }
    });
    
    return () => {
      debugLog("Cleaning up game state listener");
      unsubscribe();
    };
  }, []);

  return (
    <div className="app">
      <h1>Collaborative Math Card Game</h1>
      
      {!currentUser ? (
        <div className="join-form">
          <input
            type="text"
            placeholder="Your name"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            type="color"
            value={userColor}
            onChange={(e) => setUserColor(e.target.value)}
          />
          <button onClick={joinCollaboration}>Join Game</button>
        </div>
      ) : (
        <>
          <div className="online-users">
            <h3>Online Players</h3>
            <div className="users-list">
              {Object.values(onlineUsers).map(user => (
                <div key={user.id} className="user-item">
                  <span className="user-dot" style={{ backgroundColor: user.color }}></span>
                  <span>{user.name} {user.id === currentUser.id ? '(You)' : ''}</span>
                </div>
              ))}
            </div>
          </div>
          
          {gameState && gameState.gameActive && (
            <div className="timer-container">
              <p>Game resets in: <span className="reset-timer">{timeUntilReset}</span> seconds</p>
            </div>
          )}

          {/* Add this new thinking time UI section */}
          {gameState && gameState.gameActive && (
            <>
              {gameState.thinkingMode ? (
                <div className="thinking-mode-container">
                  <p>
                    <span className="thinking-user">{gameState.thinkingUserName}</span> is thinking
                    <span className="thinking-timer"> ({thinkingTimeLeft}s)</span>
                  </p>
                </div>
              ) : (
                <button 
                  className="thinking-button"
                  onClick={startThinkingTime}
                  disabled={Boolean(gameState.thinkingMode)}
                >
                  Take Thinking Time (10s)
                </button>
              )}
            </>
          )}

          {gameState ? (
            <>
              <div className="card-container">
              {Object.values(gameState.cards).map(card => {
                const isSelectedByMe = card.selectedBy === currentUser.id;
                const isSelectedByOther = card.selected && card.selectedBy && card.selectedBy !== currentUser.id;
                const selectingUser = isSelectedByOther && card.selectedBy ? onlineUsers[card.selectedBy] : null;
                
                // Extract the position number from card.id (e.g., "card_0" -> 0)
                const position = parseInt(card.id.split('_')[1]);
                
                // Calculate position based on card index
                const gridRow = Math.floor(position / 2) + 1;
                const gridColumn = (position % 2) + 1;
                
                return (
                  <div 
                    key={card.id} 
                    className={`card ${isSelectedByMe ? 'selected-by-me' : ''} ${isSelectedByOther ? 'selected-by-other' : ''} 
                      ${(!gameState.thinkingMode || gameState.thinkingUserId !== currentUser.id) ? 'blocked' : ''}`}
                    onClick={() => handleCardClick(card.id)}
                    style={{
                      ...isSelectedByOther && selectingUser ? { borderColor: selectingUser.color } : {},
                      gridRow: gridRow,
                      gridColumn: gridColumn,
                      // Add cursor style based on interaction state
                      cursor: (!gameState.thinkingMode || gameState.thinkingUserId !== currentUser.id) ? 'not-allowed' : 'pointer'
                    }}
                  >
                    <span className="card-value">{card.value}</span>
                    {isSelectedByOther && selectingUser && (
                      <div className="selected-by" style={{ color: selectingUser.color }}>
                        Selected by {selectingUser.name}
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
              
              <div className="game-info">
                <p>Game Status: {gameState.gameActive ? 'Active' : 'Game Over'}</p>
                <p>Selected Card: {gameState.selectedCardId || 'None'}</p>
                <p>Current Operation: {gameState.currentOperation || 'None'}</p>
              </div>
              
              <div className="operations">
                <button 
                  className={`operation-button ${gameState.currentOperation === 'add' ? 'active' : ''} ${(!gameState.thinkingMode || gameState.thinkingUserId !== currentUser.id) ? 'blocked' : ''}`}
                  onClick={() => handleOperationClick('add')}
                  disabled={Boolean(!gameState.selectedCardId || 
                                  (gameState.selectedCardId && gameState.cards[gameState.selectedCardId]?.selectedBy !== currentUser.id) ||
                                  !gameState.thinkingMode || 
                                  gameState.thinkingUserId !== currentUser.id)}
                >
                  +
                </button>
                <button 
                  className={`operation-button ${gameState.currentOperation === 'subtract' ? 'active' : ''} ${(!gameState.thinkingMode || gameState.thinkingUserId !== currentUser.id) ? 'blocked' : ''}`}
                  onClick={() => handleOperationClick('subtract')}
                  disabled={Boolean(!gameState.selectedCardId || 
                                  (gameState.selectedCardId && gameState.cards[gameState.selectedCardId]?.selectedBy !== currentUser.id) ||
                                  !gameState.thinkingMode || 
                                  gameState.thinkingUserId !== currentUser.id)}
                >
                  -
                </button>
                <button 
                  className={`operation-button ${gameState.currentOperation === 'multiply' ? 'active' : ''} ${(!gameState.thinkingMode || gameState.thinkingUserId !== currentUser.id) ? 'blocked' : ''}`}
                  onClick={() => handleOperationClick('multiply')}
                  disabled={Boolean(!gameState.selectedCardId || 
                                  (gameState.selectedCardId && gameState.cards[gameState.selectedCardId]?.selectedBy !== currentUser.id) ||
                                  !gameState.thinkingMode || 
                                  gameState.thinkingUserId !== currentUser.id)}
                >
                  x
                </button>
                <button 
                  className={`operation-button ${gameState.currentOperation === 'divide' ? 'active' : ''} ${(!gameState.thinkingMode || gameState.thinkingUserId !== currentUser.id) ? 'blocked' : ''}`}
                  onClick={() => handleOperationClick('divide')}
                  disabled={Boolean(!gameState.selectedCardId || 
                                  (gameState.selectedCardId && gameState.cards[gameState.selectedCardId]?.selectedBy !== currentUser.id) ||
                                  !gameState.thinkingMode || 
                                  gameState.thinkingUserId !== currentUser.id)}
                >
                  ÷
                </button>
              </div>
              
              {!gameState.gameActive && (
                <div className={`game-over ${gameState.gameWon ? 'game-won' : 'game-lost'}`}>
                  <h2>{gameState.gameWon ? 'You made 24! 🎉' : 'Game Over!'}</h2>
                </div>
              )}
              
              <button className="reset-button" onClick={resetGame}>
                {gameState.gameActive ? 'Reset Game' : 'New Game'}
              </button>
            </>
          ) : (
            <p>Loading game state...</p>
          )}
          
          {debugMode && (
            <div className="debug-panel">
              <h3>Debug Panel</h3>
              <button onClick={() => setDebugMode(false)}>Hide Debug</button>
              <div className="debug-messages">
                {debugMessages.map((msg, i) => (
                  <div key={i} className="debug-message">{msg}</div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;