!macro customUnInstall
  ; Close Flick and its backend before removing the files.
  nsExec::ExecToLog 'taskkill /F /T /IM "Flick.exe"'
  nsExec::ExecToLog 'taskkill /F /T /IM "flick-backend.exe"'
  ; Your presentations, settings and downloaded speech models stay in %APPDATA%\Flick.
  ; Delete that folder yourself to remove them too.
!macroend
