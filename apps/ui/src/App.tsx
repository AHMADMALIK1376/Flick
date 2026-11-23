// All pages and windows. HashRouter so it also works when Electron opens the built files.
//
//   Main window (with sidebar):  #/presentation  #/questions  #/log  #/settings
//   First run:                   #/onboarding
//   Separate Electron windows:   #/card  #/mic  #/presenter
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layout/AppLayout';
import { OnboardingFlow } from './pages/onboarding/OnboardingFlow';
import { PresentationPage } from './pages/presentation/PresentationPage';
import { PreparedQuestionsPage } from './pages/questions/PreparedQuestionsPage';
import { QaLogPage } from './pages/log/QaLogPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { AnswerCard } from './windows/card/AnswerCard';
import { MicWidget } from './windows/mic/MicWidget';
import { PresenterView } from './windows/presenter/PresenterView';

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/presentation" element={<PresentationPage />} />
          <Route path="/questions" element={<PreparedQuestionsPage />} />
          <Route path="/log" element={<QaLogPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        <Route path="/onboarding" element={<OnboardingFlow />} />

        <Route path="/card" element={<AnswerCard />} />
        <Route path="/mic" element={<MicWidget />} />
        <Route path="/presenter" element={<PresenterView />} />

        {/* TODO(#3): go to /onboarding instead when no API key is saved */}
        <Route path="*" element={<Navigate to="/presentation" replace />} />
      </Routes>
    </HashRouter>
  );
}
