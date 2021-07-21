!include "EnvVarUpdate.nsh" 

!macro &preInit
    SetRegView 64
    WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\Tools\Scratch Arduino Link"
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation ${EnvVarUpdate} $0 "PATH" "P" "HKCU" "%LocalAppData%\Programs\Scratch Arduino Link"
    SetRegView 32
    WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\Tools\Scratch Arduino Link"
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation ${EnvVarUpdate} $0 "PATH" "P" "HKCU" "%LocalAppData%\Programs\Scratch Arduino Link"
!macroend