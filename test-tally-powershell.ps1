
$xmlBody = @"
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>List of Companies</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>
"@

Write-Host "Testing Tally with PowerShell..."
Write-Host "XML length: $($xmlBody.Length)"
Write-Host "Content-Length: $([System.Text.Encoding]::UTF8.GetByteCount($xmlBody))"

try {
    $response = Invoke-WebRequest -Uri "http://localhost:9000" -Method POST -Body $xmlBody -ContentType "text/xml" -TimeoutSec 60 -DisableKeepAlive
    Write-Host "`n✅ Success! Status: $($response.StatusCode)"
    Write-Host "Response:`n$($response.Content)"
} catch {
    Write-Host "`n❌ Error:"
    if ($_.Exception.Response) {
        Write-Host "Status: $($_.Exception.Response.StatusCode.value__)"
    }
    Write-Host "Message: $($_.Exception.Message)"
    Write-Host "Stack: $($_.ScriptStackTrace)"
}
