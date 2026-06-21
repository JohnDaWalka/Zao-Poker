$dirs = @(
    "C:\Users\mfane\Poker-Therapist\desktop\renderer",
    "C:\Users\mfane\Poker-Therapist\desktop\assets",
    "C:\Users\mfane\Poker-Therapist\ios\PokerTherapist\PokerTherapist\Models",
    "C:\Users\mfane\Poker-Therapist\ios\PokerTherapist\PokerTherapist\Views",
    "C:\Users\mfane\Poker-Therapist\ios\PokerTherapist\PokerTherapist\Services"
)

foreach ($dir in $dirs) {
    try {
        New-Item -ItemType Directory -Path $dir -Force -ErrorAction Stop | Out-Null
        Write-Host "SUCCESS: $dir"
    }
    catch {
        Write-Host "FAILED: $dir - $_"
    }
}
