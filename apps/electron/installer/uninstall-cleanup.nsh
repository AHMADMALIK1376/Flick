!macro customUnInstall
  ; Kill any running instances
  nsExec::ExecToLog 'taskkill /F /IM "Voice to Text.exe"'
  
  ; Remove app data (settings, history)
  RMDir /r "$APPDATA\Voice to Text"
  RMDir /r "$APPDATA\Electron"
  
  ; Remove HuggingFace model cache (Whisper models)
  RMDir /r "$PROFILE\.cache\huggingface"
  
  ; Remove local app data
  RMDir /r "$LOCALAPPDATA\Voice to Text"
  
  ; Remove electron-builder update cache
  RMDir /r "$LOCALAPPDATA\voice-to-text-updater"
!macroend
