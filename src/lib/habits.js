// src/lib/habits.js — Habit Tracking and Daily Goals System for Makeen
// Fully persisted in localStorage, offline-first.

const HABITS_KEY = 'makeen.habits.v1';
const GOALS_KEY = 'makeen.goals.v1';

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'h_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function todayDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const DEFAULT_HABITS = [
  {
    id: 'habit_athkar',
    title: 'أذكار الصباح والمساء',
    targetCount: 2,
    frequency: 'daily',
    color: '#4f6bff',
    icon: 'moon',
    createdAt: Date.now(),
    history: {}
  },
  {
    id: 'habit_reading',
    title: 'قراءة 20 صفحة',
    targetCount: 1,
    frequency: 'daily',
    color: '#2f9e6f',
    icon: 'book',
    createdAt: Date.now(),
    history: {}
  },
  {
    id: 'habit_exercise',
    title: 'الرياضة / المشي',
    targetCount: 1,
    frequency: 'daily',
    color: '#e5484d',
    icon: 'activity',
    createdAt: Date.now(),
    history: {}
  }
];

export function listHabits() {
  if (typeof localStorage === 'undefined') return [...DEFAULT_HABITS];
  try {
    const raw = localStorage.getItem(HABITS_KEY);
    if (!raw) {
      saveHabits(DEFAULT_HABITS);
      return [...DEFAULT_HABITS];
    }
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [...DEFAULT_HABITS];
  } catch {
    return [...DEFAULT_HABITS];
  }
}

export function saveHabits(habits) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(HABITS_KEY, JSON.stringify(habits));
  } catch {}
}

export function createHabit({ title, targetCount = 1, frequency = 'daily', color = '#4f6bff', icon = 'check' }) {
  const habits = listHabits();
  const habit = {
    id: uid(),
    title: (title || 'New Habit').trim(),
    targetCount: Math.max(1, Number(targetCount) || 1),
    frequency,
    color,
    icon,
    createdAt: Date.now(),
    history: {}
  };
  habits.push(habit);
  saveHabits(habits);
  return habit;
}

export function updateHabit(id, patch) {
  const habits = listHabits();
  const idx = habits.findIndex((h) => h.id === id);
  if (idx === -1) return null;
  habits[idx] = { ...habits[idx], ...patch };
  saveHabits(habits);
  return habits[idx];
}

export function deleteHabit(id) {
  const habits = listHabits().filter((h) => h.id !== id);
  saveHabits(habits);
  return habits;
}

export function recordHabitCheck(id, dateKey = todayDateKey(), delta = 1) {
  const habits = listHabits();
  const habit = habits.find((h) => h.id === id);
  if (!habit) return null;

  if (!habit.history) habit.history = {};
  const current = Number(habit.history[dateKey]) || 0;
  const target = Number(habit.targetCount) || 1;

  let next = current + delta;
  if (delta === 1 && current >= target) {
    next = 0; // Toggle off if already complete and single click
  } else if (next < 0) {
    next = 0;
  }

  habit.history[dateKey] = next;
  saveHabits(habits);
  return habit;
}

export function getHabitStreak(habit, today = todayDateKey()) {
  if (!habit?.history) return 0;
  let streak = 0;
  const target = Number(habit.targetCount) || 1;
  const curDate = new Date();

  // If today is completed, streak includes today; otherwise check starting from yesterday
  const todayCount = Number(habit.history[today]) || 0;
  let d = new Date(curDate);
  if (todayCount >= target) {
    streak++;
    d.setDate(d.getDate() - 1);
  } else {
    d.setDate(d.getDate() - 1);
  }

  // Count backwards
  for (let i = 0; i < 365; i++) {
    const key = todayDateKey(d);
    const count = Number(habit.history[key]) || 0;
    if (count >= target) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

// --- Today's Goals API ---
export function listGoals(dateKey = todayDateKey()) {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(GOALS_KEY);
    if (!raw) return [];
    const all = JSON.parse(raw);
    return Array.isArray(all) ? all.filter((g) => g.date === dateKey) : [];
  } catch {
    return [];
  }
}

export function getAllGoals() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(GOALS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveAllGoals(goals) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(GOALS_KEY, JSON.stringify(goals));
  } catch {}
}

export function addGoal(text, dateKey = todayDateKey()) {
  if (!text || !text.trim()) return null;
  const all = getAllGoals();
  const goal = {
    id: uid(),
    text: text.trim(),
    date: dateKey,
    done: false,
    createdAt: Date.now()
  };
  all.push(goal);
  saveAllGoals(all);
  return goal;
}

export function toggleGoal(id) {
  const all = getAllGoals();
  const goal = all.find((g) => g.id === id);
  if (!goal) return null;
  goal.done = !goal.done;
  saveAllGoals(all);
  return goal;
}

export function deleteGoal(id) {
  const all = getAllGoals().filter((g) => g.id !== id);
  saveAllGoals(all);
  return all;
}
