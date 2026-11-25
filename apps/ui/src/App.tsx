// All pages and windows. HashRouter so it also works when Electron opens the built files.
//
//   Main window (with sidebar):  #/presentation  #/questions  #/log  #/settings
//   First run:                   #/onboarding
//   Separate Electron windows:   #/card  #/mic  #/presenter
import { Center, Loader } from '@mantine/core';
import { useEffect, useState } from 'react';
import { UsagePage } from './pages/usage/UsagePage';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api/flick';
import { AppLayout } from './layout/AppLayout';
import { OnboardingFlow } from './pages/onboarding/OnboardingFlow';
import { PresentationPage } from './pages/presentation/PresentationPage';
import { PreparedQuestionsPage } from './pages/questions/PreparedQuestionsPage';
import { QaLogPage } from './pages/log/QaLogPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { StudyPage } from './pages/study/StudyPage';
import { AnswerCard } from './windows/card/AnswerCard';
import { CanvasWindow } from './windows/canvas/CanvasWindow';
import { MicWidget } from './windows/mic/MicWidget';
import { PresenterView } from './windows/presenter/PresenterView';

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/presentation" element={<PresentationPage />} />
          <Route path="/study" element={<StudyPage />} />
          <Route path="/questions" element={<PreparedQuestionsPage />} />
          <Route path="/log" element={<QaLogPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        <Route path="/onboarding" element={<OnboardingFlow />} />

        <Route path="/card" element={<AnswerCard />} />
        <Route path="/canvas" element={<CanvasWindow />} />
        <Route path="/mic" element={<MicWidget />} />
        <Route path="/presenter" element={<PresenterView />} />

        <Route path="*" element={<StartRedirect />} />
      </Routes>
    </HashRouter>
  );
}

/** First open: onboarding when no Claude key is saved yet, otherwise the Presentation page. */
function StartRedirect() {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => setTarget(s.has_api_key ? '/presentation' : '/onboarding'))
      .catch(() => setTarget('/presentation')); // backend down: the sidebar shows the problem
  }, []);

  if (!target) {
    return (
      <Center h="100vh">
        <Loader color="plum" />
      </Center>
    );
  }
  return <Navigate to={target} replace />;
}
