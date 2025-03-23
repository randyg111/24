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

interface GameState {
  cards: { [key: string]: Card };
  selectedCardId: string | null;
  currentOperation: Operation | null;
  gameActive: boolean;
  lastReset: object | null;
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
        .then(() => debugLog("User saved to Firebase"))
        .catch(error => debugLog(`Error saving user: ${error.message}`));
      
      // Setup disconnect handler
      onDisconnect(ref(database, `users/${userId}`)).remove();
      
      setCurrentUser(user);
      
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
    
    for (let i = 0; i < 4; i++) {
      const cardId = `card_${i}`;
      cardsObj[cardId] = {
        id: cardId,
        value: Math.floor(Math.random() * 10) + 1, // 1-10
        selected: false,
        selectedBy: null
      };
    }
    
    const initialGameState: GameState = {
      cards: cardsObj,
      selectedCardId: null,
      currentOperation: null,
      gameActive: true,
      lastReset: serverTimestamp()
    };
    
    debugLog("Initializing new game with 4 cards");
    set(gameStateRef, initialGameState)
      .then(() => debugLog("Game initialized successfully"))
      .catch(error => debugLog(`Error initializing game: ${error.message}`));
  };

  // Reset the game
  const resetGame = (): void => {
    if (currentUser) {
      debugLog("Resetting game");
      initializeGame();
    }
  };

  // Handle card selection
  const handleCardClick = (cardId: string): void => {
    if (!currentUser || !gameState || !gameState.gameActive) {
      debugLog("Cannot select card: user not logged in or game not active");
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
    if (gameState.selectedCardId === undefined) {
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
    else if (gameState.currentOperation !== null && gameState.selectedCardId !== null && cardId !== gameState.selectedCardId) {
      // Second card selection (perform operation)
      debugLog(`Performing ${gameState.currentOperation} with cards ${gameState.selectedCardId} and ${cardId}`);
      
      // Call the operation function with null checks
      if (gameState.selectedCardId && cardId) {
        performOperation(gameState.selectedCardId, cardId, gameState.currentOperation);
      } else {
        debugLog("Cannot perform operation: missing card ID");
      }
    } 
    // Replace first selection with a new card when no operation is selected
    else if (gameState.currentOperation === null && gameState.selectedCardId !== null && cardId !== gameState.selectedCardId) {
      debugLog(`Replacing selected card ${gameState.selectedCardId} with ${cardId}`);
      
      // Deselect the previous card
      update(ref(database, `gameState/cards/${gameState.selectedCardId}`), {
        selected: false,
        selectedBy: null
      }).then(() => debugLog("Previous card deselected"))
        .catch(error => debugLog(`Error deselecting previous card: ${error.message}`));
      
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
        result = secondCard.value - firstCard.value;
        break;
      case 'multiply':
        result = firstCard.value * secondCard.value;
        break;
      case 'divide':
        // Prevent division by zero
        if (firstCard.value === 0) {
          debugLog("Cannot divide by zero");
          return;
        }
        result = secondCard.value / firstCard.value;
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
    
    // Remove the first card but preserve its ID to maintain position
    remove(ref(database, `gameState/cards/${firstCardId}`))
      .then(() => debugLog("First card removed"))
      .catch(error => debugLog(`Error removing first card: ${error.message}`));
    
    // Reset operation but keep the second card selected
    update(ref(database, 'gameState'), { 
      selectedCardId: secondCardId,
      currentOperation: null 
    }).then(() => debugLog("Game state updated: operation reset, second card still selected"))
      .catch(error => debugLog(`Error updating game state: ${error.message}`));
    
    setLocalSelectedCard(secondCardId);
    
    // Check if game is over (only one card remains)
    const remainingCards = Object.keys(gameState.cards).filter(id => id !== firstCardId);
    if (remainingCards.length === 1) {
      debugLog("Game over - only one card remains");
      update(ref(database, 'gameState'), { gameActive: false })
        .then(() => debugLog("Game state updated to inactive"))
        .catch(error => debugLog(`Error updating game activity: ${error.message}`));
    }
  }

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
                    className={`card ${isSelectedByMe ? 'selected-by-me' : ''} ${isSelectedByOther ? 'selected-by-other' : ''}`}
                    onClick={() => handleCardClick(card.id)}
                    style={{
                      ...isSelectedByOther && selectingUser ? { borderColor: selectingUser.color } : {},
                      gridRow: gridRow,
                      gridColumn: gridColumn
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
                  className={`operation-button ${gameState.currentOperation === 'add' ? 'active' : ''}`}
                  onClick={() => handleOperationClick('add')}
                  disabled={Boolean(!gameState.selectedCardId || (gameState.selectedCardId && gameState.cards[gameState.selectedCardId]?.selectedBy !== currentUser.id))}
                >
                  +
                </button>
                <button 
                  className={`operation-button ${gameState.currentOperation === 'subtract' ? 'active' : ''}`}
                  onClick={() => handleOperationClick('subtract')}
                  disabled={Boolean(!gameState.selectedCardId || (gameState.selectedCardId && gameState.cards[gameState.selectedCardId]?.selectedBy !== currentUser.id))}
                >
                  -
                </button>
                <button 
                  className={`operation-button ${gameState.currentOperation === 'multiply' ? 'active' : ''}`}
                  onClick={() => handleOperationClick('multiply')}
                  disabled={Boolean(!gameState.selectedCardId || (gameState.selectedCardId && gameState.cards[gameState.selectedCardId]?.selectedBy !== currentUser.id))}
                >
                  ×
                </button>
                <button 
                  className={`operation-button ${gameState.currentOperation === 'divide' ? 'active' : ''}`}
                  onClick={() => handleOperationClick('divide')}
                  disabled={Boolean(!gameState.selectedCardId || (gameState.selectedCardId && gameState.cards[gameState.selectedCardId]?.selectedBy !== currentUser.id))}
                >
                  ÷
                </button>
              </div>
              
              {!gameState.gameActive && Object.keys(gameState.cards).length === 1 && (
                <div className="game-over">
                  <h2>Game Over!</h2>
                  <p>Final Value: {Object.values(gameState.cards)[0]?.value}</p>
                  <button className="reset-button" onClick={resetGame}>
                    Play Again
                  </button>
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