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
  score: number; // Added score property
}

interface Card {
  id: string;
  selected: boolean;
  selectedBy: string | null;
  num: number;
  denom: number;
}

interface CardHistory {
  id: string;
  num: number;
  denom: number;
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
  timerEndTime: number | null;
  thinkingEndTime: number | null;
  cardHistory: CardHistory[];
  gameWon: boolean;
  lastWinner: string | null; // Added to track the last winner
}

interface Users {
  [key: string]: User;
}

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
  const [resetTimerId, setResetTimerId] = useState<NodeJS.Timeout | null>(null);
  const [timeUntilReset, setTimeUntilReset] = useState<number>(30);
  const [thinkingTimeLeft, setThinkingTimeLeft] = useState<number>(10);
  const [thinkingTimerId, setThinkingTimerId] = useState<NodeJS.Timeout | null>(null);
  const [savedTimeUntilReset, setSavedTimeUntilReset] = useState<number>(30);

  const startThinkingTime = (): void => {
    if (!currentUser || !gameState || !gameState.gameActive) return;
    if (gameState.thinkingMode) return;
    
    // Calculate end times based on server time + durations
    const now = Date.now();
    const thinkingEndTime = now + 10000; // 10 seconds
    
    // Save the current game timer remaining time before pausing
    const remainingGameTime = gameState.timerEndTime ? 
      Math.max(0, Math.ceil((gameState.timerEndTime - now) / 1000)) : 
      30;
    
    setSavedTimeUntilReset(remainingGameTime);
    
    // Update Firebase
    update(ref(database, 'gameState'), { 
      thinkingMode: true,
      thinkingUserId: currentUser.id,
      thinkingUserName: currentUser.name,
      thinkingEndTime: thinkingEndTime
    });
    
    setThinkingTimeLeft(10);
  };

  // Modify the endThinkingTime function
  const endThinkingTime = (): void => {
    if (!currentUser || !gameState) return;
    
    // Clear thinking timer
    if (thinkingTimerId) {
      clearInterval(thinkingTimerId);
      setThinkingTimerId(null);
    }
    
    // Check if player succeeded (one card with value 24)
    const remainingCards = Object.values(gameState.cards);
    const succeeded = remainingCards.length === 1 && Math.abs(remainingCards[0].num/remainingCards[0].denom - 24) < 0.001;
    
    if (succeeded) {
      // Player succeeded - end game
      
      // Update player score directly in Firebase, don't modify local state first
      const userRef = ref(database, `users/${currentUser.id}`);
      const newScore = currentUser.score += 1;
      
      update(userRef, {
        score: newScore
      }).then(() => {
        // After score is updated, update game state
        update(ref(database, 'gameState'), { 
          thinkingMode: false,
          thinkingUserId: null,
          thinkingUserName: null,
          thinkingEndTime: null,
          gameActive: false,
          gameWon: true,
          lastWinner: currentUser.id // Track the winner's ID
        });
      });
      
    } else {
      // Player failed - reset cards to original state
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
      });
    }
  };

  const resetCardsToOriginal = (): void => {
    if (!gameState) return;
    
    const newCards: { [key: string]: Card } = {};
    
    // Recreate all cards with original values
    gameState.cardHistory.forEach(historyCard => {
      newCards[historyCard.id] = {
        id: historyCard.id,
        num: historyCard.num,
        denom: historyCard.denom,
        selected: false,
        selectedBy: null
      };
    });
    
    // Update Firebase with reset cards
    update(ref(database, 'gameState'), {
      cards: newCards,
      selectedCardId: null,
      currentOperation: null
    });
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
          // resetGame();
          update(ref(database, 'gameState'), { 
            gameActive: false,
            gameWon: false
          });
        }
      }
      
      // Update thinking timer if in thinking mode
      if (gameState.thinkingMode && gameState.thinkingEndTime) {
        const thinkingSecondsLeft = Math.max(0, Math.ceil((gameState.thinkingEndTime - now) / 1000));
        setThinkingTimeLeft(thinkingSecondsLeft);
        
        // If thinking timer expired, end thinking time (but only do this once)
        if (thinkingSecondsLeft === 0 && gameState.thinkingEndTime > now - 1000) {
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

  // Clean up game state when no users are online
  useEffect(() => {
    if (!database) return;
    
    const usersRef = ref(database, 'users');
    
    const unsubscribe = onValue(usersRef, (snapshot) => {
      if (!snapshot.exists() || Object.keys(snapshot.val()).length === 0) {
        cleanupGameState();
      }
    });
    
    return () => {
      unsubscribe();
    };
  }, [database]);

  const cleanupGameState = (): void => {
    if (!database) return;
    remove(ref(database, 'gameState'));
  };

  // Join collaboration session
  const joinCollaboration = (): void => {
    if (username.trim()) {
      const userId = 'user_' + Date.now();
      const user: User = {
        id: userId,
        name: username,
        color: userColor,
        lastActive: serverTimestamp(),
        score: 0 // Initialize score to 0
      };
  
      // Save user to Firebase
      set(ref(database, `users/${userId}`), user)
        .then(() => {
          setCurrentUser(user);
          
          // Force immediate timer start
          if (resetTimerId) {
            clearInterval(resetTimerId);
            setResetTimerId(null);
          }
          
          // Create a new timer immediately without waiting for useEffect
          const newTimerId = setInterval(() => {
            setTimeUntilReset(prevTime => {
              const newTime = prevTime - 1;
              if (newTime <= 0) {
                resetGame();
                return 30;
              }
              return newTime;
            });
          }, 1000);
          
          setResetTimerId(newTimerId);
          setTimeUntilReset(30);
        });
      
      // Setup disconnect handler
      onDisconnect(ref(database, `users/${userId}`)).remove();
      
      // Check if game exists, if not initialize it
      const gameStateRef = ref(database, 'gameState');
      onValue(gameStateRef, (snapshot) => {
        if (!snapshot.exists()) {
          initializeGame();
        }
      }, { onlyOnce: true });
    }
  };

  // Initialize game with 4 random cards
  const initializeGame = (): void => {
    const gameStateRef = ref(database, 'gameState');
    const cardsObj: { [key: string]: Card } = {};
    const cardHistory: CardHistory[] = [];
    
    // Generate random cards
    for (let i = 0; i < 4; i++) {
      const cardId = `card_${i}`;
      const cardValue = Math.floor(Math.random() * 10) + 1; // 1-10
      
      cardsObj[cardId] = {
        id: cardId,
        num: cardValue,
        denom: 1,
        selected: false,
        selectedBy: null
      };
      
      // Add to card history
      cardHistory.push({
        id: cardId,
        num: cardValue,
        denom: 1,
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
      gameWon: false,
      lastWinner: null // Initialize lastWinner to null
    };
    
    set(gameStateRef, initialGameState)
      .then(() => {
        setTimeUntilReset(30);
        setThinkingTimeLeft(10);
      });
  };

  // Reset the game
  const resetGame = (): void => {
    if (currentUser) {
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
      return;
    }
    
    // Check if thinking mode is active and user is not the thinking user
    if (!gameState.thinkingMode || gameState.thinkingUserId !== currentUser.id) {
      return;
    }
    
    const card = gameState.cards[cardId];
    if (!card) {
      return;
    }
    
    // Card is already selected by someone else
    if (card.selected && card.selectedBy && card.selectedBy !== currentUser.id) {
      return;
    }
    
    // Check for inconsistent state and reset if needed
    if ((gameState.selectedCardId && !gameState.cards[gameState.selectedCardId]) || 
        (gameState.currentOperation && !gameState.selectedCardId)) {
      
      // Reset Firebase game state
      update(ref(database, 'gameState'), { 
        selectedCardId: null, 
        currentOperation: null 
      });
      
      return;
    }
    
    // First card selection (no card currently selected)
    if (!gameState.selectedCardId) {
      // Update card in Firebase
      update(ref(database, `gameState/cards/${cardId}`), {
        selected: true,
        selectedBy: currentUser.id
      });
      
      // Update game state in Firebase
      update(ref(database, 'gameState'), { 
        selectedCardId: cardId 
      });
      
    } 
    // Second card selection with operation
    else if (gameState.currentOperation && cardId !== gameState.selectedCardId) {
      // Call the operation function with null checks
      if (gameState.selectedCardId && cardId) {
        performOperation(gameState.selectedCardId, cardId, gameState.currentOperation);
      }
    } 
    // Switching to a different card without operation
    else if (!gameState.currentOperation && cardId !== gameState.selectedCardId) {
      // Deselect the previous card
      if (gameState.selectedCardId) {
        update(ref(database, `gameState/cards/${gameState.selectedCardId}`), {
          selected: false,
          selectedBy: null
        });
      }
      
      // Select the new card
      update(ref(database, `gameState/cards/${cardId}`), {
        selected: true,
        selectedBy: currentUser.id
      });
      
      // Update selected card in game state
      update(ref(database, 'gameState'), { 
        selectedCardId: cardId 
      });
      
    }
    // Deselect case
    else if (cardId === gameState.selectedCardId && card.selectedBy === currentUser.id) {
      // Update card in Firebase
      update(ref(database, `gameState/cards/${cardId}`), {
        selected: false,
        selectedBy: null
      });
      
      // Update game state in Firebase
      update(ref(database, 'gameState'), { 
        selectedCardId: null, 
        currentOperation: null 
      });
      
    }
  };

  // Handle operation selection
  const handleOperationClick = (operation: Operation): void => {
    if (!currentUser || !gameState || gameState.selectedCardId === null) {
      return;
    }
    
    // Only allow operation selection during thinking time of the current user
    if (!gameState.thinkingMode || gameState.thinkingUserId !== currentUser.id) {
      return;
    }
    
    // Check if the selected card belongs to this user
    const selectedCard = gameState.cards[gameState.selectedCardId];
    if (!selectedCard || selectedCard.selectedBy !== currentUser.id) {
      return;
    }
    
    update(ref(database, 'gameState'), { currentOperation: operation });
  };

  const gcd = (a: number, b: number): number => {
    return a % b == 0 ? b : gcd(b, b % a);
  };

  // Perform operation between two cards
  const performOperation = (firstCardId: string, secondCardId: string, operation: Operation): void => {
    if (!currentUser || !gameState) {
      return;
    }
    
    const firstCard = gameState.cards[firstCardId];
    const secondCard = gameState.cards[secondCardId];
    
    if (!firstCard || !secondCard) {
      return;
    }
    
    let rnum: number;
    let rdenom: number;
    
    switch(operation) {
      case 'add':
        rnum = firstCard.num * secondCard.denom + firstCard.denom * secondCard.num;
        rdenom = firstCard.denom * secondCard.denom;
        break;
      case 'subtract':
        rnum = firstCard.num * secondCard.denom - firstCard.denom * secondCard.num;
        rdenom = firstCard.denom * secondCard.denom;
        break;
      case 'multiply':
        rnum = firstCard.num * secondCard.num;
        rdenom = firstCard.denom * secondCard.denom;
        break;
      case 'divide':
        rnum = firstCard.num * secondCard.denom;
        rdenom = firstCard.denom * secondCard.num;
        break;
      default:
        return;
    }
    const d = gcd(rnum, rdenom);
    rnum /= d;
    rdenom /= d;
    
    // Update the second card with the result, but keep it selected
    update(ref(database, `gameState/cards/${secondCardId}`), {
      num: rnum,
      denom: rdenom,
      selected: true,
      selectedBy: currentUser.id
    });
    
    // Update card history - mark first card as removed
    const updatedHistory = gameState.cardHistory.map(card => {
      if (card.id === firstCardId) {
        return { ...card, isRemoved: true };
      }
      return card;
    });
    
    // Remove the first card but preserve its ID to maintain position
    remove(ref(database, `gameState/cards/${firstCardId}`));
    
    // Reset operation but keep the second card selected
    update(ref(database, 'gameState'), { 
      selectedCardId: secondCardId,
      currentOperation: null,
      cardHistory: updatedHistory
    });
    
    
    // Check if game is won (only one card remains with value 24)
    const remainingCards = Object.values(gameState.cards).filter(c => c.id !== firstCardId);
    if (remainingCards.length === 1 && Math.abs(rnum/rdenom - 24) < 0.001) {
      // Update player score directly in Firebase, don't modify local state first
      const userRef = ref(database, `users/${currentUser.id}`);
      const newScore = currentUser.score += 1;
      
      update(userRef, {
        score: newScore
      }).then(() => {
        // After score is updated, update game state
        update(ref(database, 'gameState'), { 
          gameActive: false,
          gameWon: true,
          lastWinner: currentUser.id
        });
      });
    }
  };

  // Listen for online users
  useEffect(() => {
    const usersRef = ref(database, 'users');
    
    const unsubscribe = onValue(usersRef, (snapshot) => {
      if (snapshot.exists()) {
        const users = snapshot.val() as Users;
        setOnlineUsers(users);
      } else {
        setOnlineUsers({});
      }
    });
    
    return () => {
      unsubscribe();
    };
  }, []);

  // Listen for game state changes
  useEffect(() => {
    const gameStateRef = ref(database, 'gameState');
    
    const unsubscribe = onValue(gameStateRef, (snapshot) => {
      if (snapshot.exists()) {
        const state = snapshot.val() as GameState;
        setGameState(state);
      } else {
        setGameState(null);
      }
    });
    
    return () => {
      unsubscribe();
    };
  }, []);

  const solve = (): number[] => {
    const dq: number[] = [];
    if (recurse([gameState!.cardHistory[0].num, gameState!.cardHistory[1].num, gameState!.cardHistory[2].num, gameState!.cardHistory[3].num], dq, 24)) {
        return dq;
    }
    return [];
  }

  const recurse = (nums: number[], dq: number[], x: number): boolean => {
      if (dq.length === 7) {
          return Math.abs(calc(dq) - x) < 1e-6;
      }
      if (dq.length + 2 * nums.length < 7) {
          for (let i = -1; i >= -4; i--) {
              dq.push(i);
              if (recurse(nums, dq, x)) return true;
              dq.pop();
          }
      }
      for (let i = 0; i < nums.length; i++) {
          const num = nums.splice(i, 1)[0];
          dq.push(num);
          if (recurse(nums, dq, x)) return true;
          dq.pop();
          nums.splice(i, 0, num);
      }
      return false;
  }

  const calc = (dq: number[]): number => {
      const stack: number[] = [];
      for (const i of dq) {
          if (i > 0) {
              stack.push(i);
              continue;
          }
          const b = stack.pop()!, a = stack.pop()!;
          switch (i) {
              case -1:
                  stack.push(a + b);
                  break;
              case -2:
                  stack.push(a - b);
                  break;
              case -3:
                  stack.push(a * b);
                  break;
              case -4:
                  stack.push(a / b);
                  break;
          }
      }
      if (stack.length === 0) return 0;
      return stack[stack.length - 1];
  }

  const convert = (dq: number[]): string => {
    if (dq.length == 0) return "No solution.";
    const stack: string[] = [];
    for (const i of dq) {
        if (i > 0) {
            stack.push(i.toString());
            continue;
        }
        const b = stack.pop(), a = stack.pop();
        switch (i) {
            case -1:
                stack.push(`(${a} + ${b})`);
                break;
            case -2:
                stack.push(`(${a} - ${b})`);
                break;
            case -3:
                stack.push(`(${a} * ${b})`);
                break;
            case -4:
                stack.push(`(${a} / ${b})`);
                break;
        }
    }
    return stack[stack.length - 1] + " = 24";
  }

  // Get winner name from winner ID
  const getWinnerName = (winnerId: string | null): string => {
    if (!winnerId || !onlineUsers[winnerId]) return "Unknown";
    return onlineUsers[winnerId].name;
  };

  return (
    <div className="app">
      <h1>24 Game</h1>
      
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
                  <span>
                    {user.name} {user.id === currentUser.id ? '(You)' : ''}
                    <span className="user-score">{user.score > 0 ? ` - ${user.score} ${user.score === 1 ? 'point' : 'points'}` : ''}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          
          {gameState && gameState.gameActive && (
            <div className="game-status-container">
              <div className="timer-container">
                <p>Time left: <span className="reset-timer">{timeUntilReset}</span> seconds</p>
              </div>

              <div className="thinking-section">
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
                    Make 24 (10s)
                  </button>
                )}
              </div>
            </div>
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
                        cursor: (!gameState.thinkingMode || gameState.thinkingUserId !== currentUser.id) ? 'not-allowed' : 'pointer'
                      }}
                    >
                      <span className="card-value">{Math.round((card.num / card.denom) * 100) / 100}</span>
                      {isSelectedByOther && selectingUser && (
                        <div className="selected-by" style={{ color: selectingUser.color }}>
                          Selected by {selectingUser.name}
                        </div>
                      )}
                    </div>
                  );
                })}
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
                  <h2>{gameState.gameWon ? (gameState.lastWinner == currentUser.id ? 'You made 24! 🎉' : getWinnerName(gameState.lastWinner) + ' made 24!') : 'Game Over! ' + convert(solve())}</h2>
                  <button className="reset-button" onClick={resetGame}>
                    New Game
                  </button>
                </div>
              )}

              {/* <button className="reset-button" onClick={resetGame}>
                {gameState.gameActive ? 'Reset Game' : 'New Game'}
              </button> */}
            </>
          ) : (
            <p>Loading game state...</p>
          )}
        </>
      )}
    </div>
  );
}

export default App;