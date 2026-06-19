import { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { AppProvider, useApp } from './store/AppContext';
import Dashboard from './components/Dashboard';
import Profile from './components/Profile';
import GlucoseLog from './components/GlucoseLog';
import MealLog from './components/MealLog';
import InsulinAdvisor from './components/InsulinAdvisor';
import Reminders from './components/Reminders';
import Settings from './components/Settings';
import Achievements from './components/Achievements';
import { findMealsNeedingInsulin, buildInsulinReminderMessage } from './utils/insulinReminder';
import { LayoutDashboard, Activity, Utensils, Syringe, Bell, Settings as Gear, X } from 'lucide-react';
import './App.css';

// App-wide: detect meals lacking an insulin injection and nudge the user
function useInsulinReminder() {
  const { state } = useApp();
  const [pending, setPending] = useState([]);
  const notifiedRef = useRef(new Set());

  useEffect(() => {
    const check = () => {
      const list = findMealsNeedingInsulin(state.meals, state.insulinLogs);
      setPending(list);
      if (state.reminders?.enabled?.insulin && 'Notification' in window && Notification.permission === 'granted') {
        for (const p of list) {
          const key = p.meal.timestamp;
          if (!notifiedRef.current.has(key)) {
            notifiedRef.current.add(key);
            new Notification('DiaGuide 胰島素提醒', { body: buildInsulinReminderMessage([p]) });
          }
        }
      }
    };
    check();
    const id = setInterval(check, 5 * 60 * 1000); // re-check every 5 min
    return () => clearInterval(id);
  }, [state.meals, state.insulinLogs, state.reminders]);

  return pending;
}

function InsulinReminderBar() {
  const pending = useInsulinReminder();
  const nav = useNavigate();
  const [dismissed, setDismissed] = useState(null);

  if (!pending.length) return null;
  const topKey = pending[0].meal.timestamp;
  if (dismissed === topKey) return null;

  return (
    <div className="insulin-reminder-bar" onClick={() => nav('/insulin')}>
      <Syringe size={15} />
      <span>{buildInsulinReminderMessage(pending)}</span>
      <button className="irb-close" onClick={e => { e.stopPropagation(); setDismissed(topKey); }}>
        <X size={14} />
      </button>
    </div>
  );
}

function Layout() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">💉 DiaGuide</div>
        <span className="logo-sub">糖尿病管理系統</span>
      </header>

      <InsulinReminderBar />

      <main className="app-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/glucose" element={<GlucoseLog />} />
          <Route path="/meals" element={<MealLog />} />
          <Route path="/insulin" element={<InsulinAdvisor />} />
          <Route path="/reminders" element={<Reminders />} />
          <Route path="/achievements" element={<Achievements />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      <nav className="bottom-nav">
        <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <LayoutDashboard size={20} /><span>首頁</span>
        </NavLink>
        <NavLink to="/glucose" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <Activity size={20} /><span>血糖</span>
        </NavLink>
        <NavLink to="/meals" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <Utensils size={20} /><span>飲食</span>
        </NavLink>
        <NavLink to="/insulin" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <Syringe size={20} /><span>劑量</span>
        </NavLink>
        <NavLink to="/reminders" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <Bell size={20} /><span>提醒</span>
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <Gear size={20} /><span>設定</span>
        </NavLink>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Layout />
      </BrowserRouter>
    </AppProvider>
  );
}
