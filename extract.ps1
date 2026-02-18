$src = "C:\Users\91982\Downloads\safeclaw\SafeClaw-Architecture-Spec.docx"
$srcZip = "C:\Users\91982\Downloads\safeclaw\SafeClaw-Architecture-Spec.zip"
$dest = "C:\Users\91982\Downloads\safeclaw\arch-unpacked"

# Copy with .zip extension so PowerShell accepts it
Copy-Item -Path $src -Destination $srcZip -Force
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive -Force -LiteralPath $srcZip -DestinationPath $dest
Remove-Item $srcZip
Write-Host "Done"
