import { createContext, useContext, useReducer, useEffect, useRef, useState } from 'react';
import { supabase, supabaseReady } from '../lib/supabase';
import { useAuth } from './AuthContext';

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
    case 'LOAD_STATE': return { ...initialState, ...action.payload };
    default: return state;
  }
}

const LOCAL_KEY = 'diabetesApp';

// Strip non-persistent / transient fields before saving
function serialize(state) {
  const { dataInsufficiencyFlags, ...rest } = state;
  return rest;
}

export function AppProvider({ children }) {
  const { user } = useAuth();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef(null);

  // ── Load this user's data from the cloud (with one-time localStorage migration) ──
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);

    async function load() {
      // No auth backend → fall back to local-only (dev / unconfigured)
      if (!supabaseReady || !user) {
        try {
          const saved = localStorage.getItem(LOCAL_KEY);
          if (saved && !cancelled) dispatch({ type: 'LOAD_STATE', payload: JSON.parse(saved) });
        } catch { /* ignore */ }
        if (!cancelled) setLoaded(true);
        return;
      }

      const { data, error } = await supabase
        .from('app_state')
        .select('data')
        .eq('user_id', user.id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error('[AppState] load error:', error.message);
        setLoaded(true);
        return;
      }

      if (data?.data) {
        // Existing cloud data → source of truth
        dispatch({ type: 'LOAD_STATE', payload: data.data });
      } else {
        // No cloud row yet → migrate this device's localStorage on first login
        let migrated = null;
        try {
          const saved = localStorage.getItem(LOCAL_KEY);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.profile || parsed.glucoseReadings?.length || parsed.meals?.length) {
              migrated = parsed;
            }
          }
        } catch { /* ignore */ }

        if (migrated) {
          dispatch({ type: 'LOAD_STATE', payload: migrated });
          await supabase.from('app_state').upsert({
            user_id: user.id,
            data: serialize({ ...initialState, ...migrated }),
            updated_at: new Date().toISOString(),
          });
        }
      }
      setLoaded(true);
    }

    load();
    return () => { cancelled = true; };
  }, [user]);

  // ── Persist on change (debounced) ──
  useEffect(() => {
    if (!loaded) return; // don't overwrite before initial load completes

    // Always keep a local cache for fast reload / offline
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(serialize(state))); } catch { /* ignore */ }

    if (!supabaseReady || !user) return;

    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const { error } = await supabase.from('app_state').upsert({
        user_id: user.id,
        data: serialize(state),
        updated_at: new Date().toISOString(),
      });
      if (error) console.error('[AppState] save error:', error.message);
    }, 800);

    return () => clearTimeout(saveTimer.current);
  }, [state, loaded, user]);

  return (
    <AppContext.Provider value={{ state, dispatch, loaded }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
