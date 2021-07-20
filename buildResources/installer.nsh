!macro preInit
  SetRegView 64
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\Tools\Scratch Arduino Link"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "%LocalAppData%\Programs\Scratch Arduino Link"
  SetRegView 32
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\Tools\Scratch Arduino Link"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "%LocalAppData%\Programs\Scratch Arduino Link"
!macroend