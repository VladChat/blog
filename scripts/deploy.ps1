git add -A
$commitMessage = "Auto-deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git commit -m "$commitMessage"
git push origin main
