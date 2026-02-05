
import { WorkLog, DailyTimeCard, User } from '../types';

const LOGS_KEY = 'chronoLogs';
const TIME_CARDS_KEY = 'chronoTimeCards';

export const storageService = {
  // Work Logs
  getLogs: (): WorkLog[] => {
    const saved = localStorage.getItem(LOGS_KEY);
    return saved ? JSON.parse(saved) : [];
  },

  saveLog: (log: WorkLog) => {
    const logs = storageService.getLogs();
    logs.push(log);
    localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
  },

  deleteLog: (logId: string) => {
    const logs = storageService.getLogs();
    const filtered = logs.filter(l => l.id !== logId);
    localStorage.setItem(LOGS_KEY, JSON.stringify(filtered));
  },

  // Daily Time Cards
  getTimeCards: (): DailyTimeCard[] => {
    const saved = localStorage.getItem(TIME_CARDS_KEY);
    return saved ? JSON.parse(saved) : [];
  },

  saveTimeCard: (card: DailyTimeCard) => {
    const cards = storageService.getTimeCards();
    // Check if update or new
    const index = cards.findIndex(c => c.id === card.id);
    if (index >= 0) {
      cards[index] = card;
    } else {
      cards.push(card);
    }
    localStorage.setItem(TIME_CARDS_KEY, JSON.stringify(cards));
  },

  // Helper to get stats
  getAllData: () => {
    return {
      logs: storageService.getLogs(),
      timeCards: storageService.getTimeCards()
    };
  },
  
  // Clear all data (debug/reset)
  clearAll: () => {
    localStorage.removeItem(LOGS_KEY);
    localStorage.removeItem(TIME_CARDS_KEY);
  }
};
