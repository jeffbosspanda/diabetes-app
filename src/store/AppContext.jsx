import { createContext, useContext, useReducer, useEffect } from 'react';

const AppContext = createContext();

const initialState = {
  profile: null,
  glucoseReadings: [],
  meals: [],
  insulinLogs: [],
  exerciseLogs: [],
  waterLogs: [],
  reminders: {
    mealTimes: { breakfast: '07:30', lunch: '12:00', dinner: '18:30', lateSnack: '21:00' },
    enabled: { meal: true, exercise: true, water: true, insulin: true },
  },
  icr: null,
  isf: null,
  settings: {
    insulinBrand: 'NovoRapid',
    rapidBrand: 'NovoRapid',
    shortBrand: 'Humulin R',
    longBrand: 'Tresiba',
    rapidBrandConfirmed: false,
    shortBrandConfirmed: false,
    longBrandConfirmed: false,
    targetBG: 100,
    bgUnit: 'mg/dL',
    vegetarianType: 'none',
    avoidFoods: '',
    integrations: { freestyleLibre: false, strava: false, appleHealth: false },
  },
  dataInsufficiencyFlags: [],
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_PROFILE': return { ...state, profile: action.payload };
    case 'ADD_GLUCOSE': return { ...state, glucoseReadings: [...state.glucoseReadings, action.payload] };
    case 'ADD_MEAL': return { ...state, meals: [...state.meals, action.payload] };
    case 'UPDATE_MEAL': return { ...state, meals: state.meals.map((m, i) => i === action.payload.index ? { ...m, ...action.payload.data } : m) };
    case 'DELETE_MEAL': return { ...state, meals: state.meals.filter((_, i) => i !== action.payload) };
    case 'ADD_INSULIN_LOG': return { ...state, insulinLogs: [...state.insulinLogs, action.payload] };
    case 'UPDATE_INSULIN_LOG': return { ...state, insulinLogs: state.insulinLogs.map((l, i) => i === action.payload.index ? { ...l, ...action.payload.data } : l) };
    case 'DELETE_INSULIN_LOG': return { ...state, insulinLogs: state.insulinLogs.filter((_, i) => i !== action.payload) };
    case 'ADD_EXERCISE': return { ...state, exerciseLogs: [...state.exerciseLogs, action.payload] };
    case 'ADD_WATER': return { ...state, waterLogs: [...state.waterLogs, action.payload] };
    case 'UPDATE_REMINDERS': return { ...state, reminders: { ...state.reminders, ...action.payload } };
    case 'UPDATE_SETTINGS': return { ...state, settings: { ...state.settings, ...action.payload } };
    case 'UPDATE_ICR_ISF': return { ...state, icr: action.payload.icr, isf: action.payload.isf };
    case 'SET_DATA_FLAGS': return { ...state, dataInsufficiencyFlags: action.payload };
    case 'LOAD_STATE': return { ...state, ...action.payload };
    default: return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState, (init) => {
    try {
      const saved = localStorage.getItem('diabetesApp');
      return saved ? { ...init, ...JSON.parse(saved) } : init;
    } catch { return init; }
  });

  useEffect(() => {
    localStorage.setItem('diabetesApp', JSON.stringify(state));
  }, [state]);

  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);
