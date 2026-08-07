[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12  
=New-Object System.Net.WebClient  
.Headers['Authorization']='token <YOUR_GITHUB_TOKEN>'  
.Headers['Content-Type']='application/octet-stream'  
Write-Host 'Uploading...'  
='e:\projects\installer\dist\Posnic-Setup-1.0.2.exe'  
='https://uploads.github.com/repos/Posnic/installer/releases/331394021/assets?name=Posnic-Setup-1.0.2.exe'  
=.UploadFile(,'POST',)  
Write-Host ([System.Text.Encoding]::UTF8.GetString())  
.Dispose() 
