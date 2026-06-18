$file = 'C:\Users\Administrator\Downloads\csr-monitor-lite\server\src\app.js'
$content = [System.IO.File]::ReadAllText($file)

# Remove the corrupted GET inspections route (it's a string literal with \n)
$pattern = '(?s)"  app\.get\(\'\/api\/inspections\', requireAuth\(db\).*?res\.json\(\{ records: rows\.map\(mapInspection\) \}\);\s*\}\);"'
$content = [regex]::Replace($content, $pattern, '')

# Remove the duplicate old export route
$pattern2 = '(?s)\s*app\.post\(\'\/api\/inspections\/export\', requireAuth\(db\), async \(req, res\) => \{\s*const ids = Array\.isArray\(req\.body\.ids\).*?const rows = db\.all\(sql, params\);\s*const workbook = new ExcelJS\.Workbook\(\);'
$replacement = "`r`n  const workbook = new ExcelJS.Workbook();"
$content = [regex]::Replace($content, $pattern2, $replacement)

[System.IO.File]::WriteAllText($file, $content, (New-Object System.Text.UTF8Encoding $true))
Write-Host 'Fixed app.js'