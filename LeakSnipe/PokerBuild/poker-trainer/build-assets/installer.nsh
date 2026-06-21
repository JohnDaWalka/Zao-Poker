; Custom NSIS installer script for Poker Therapist Suite

!macro customInstall
  ; Create hand history directories for CoinPoker if they don't exist
  CreateDirectory "$LOCALAPPDATA\CoinPoker\HandHistory"

  ; Write registry entries
  WriteRegStr HKCU "Software\PokerTherapistSuite" "InstallPath" "$INSTDIR"
  WriteRegStr HKCU "Software\PokerTherapistSuite" "HeroName" "jdwalka"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\PokerTherapistSuite"
!macroend
