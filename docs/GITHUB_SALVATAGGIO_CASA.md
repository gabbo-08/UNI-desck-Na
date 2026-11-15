# Salvare UniDesk NA su GitHub dal PC di casa

Questa procedura evita di pubblicare `.env`, password, database, log e altri dati personali.

## 1. Configurare Git

```powershell
git --version
git config --global user.name "Nome Cognome"
git config --global user.email "email-usata-su-github@example.com"
```

## 2. Scaricare il repository

```powershell
Set-Location "$env:USERPROFILE\Documents"
git clone https://github.com/TUO-ACCOUNT/TUO-REPOSITORY.git unidesk-na
Set-Location .\unidesk-na
```

Se hai già la cartella, usa direttamente `Set-Location "PERCORSO\unidesk-na"`.

## 3. Controllare stato e file esclusi

```powershell
git status --short
git remote -v
git check-ignore -v .env data\unicorno.sqlite logs\app.log frontend\.env.local
```

Se `.env` o il database compaiono nello stato Git, fermati e non eseguire `git add`.

## 4. Collegare il repository remoto, se manca

Crea su GitHub un repository vuoto, senza README, licenza o `.gitignore` automatici:

```powershell
git remote add origin https://github.com/TUO-ACCOUNT/TUO-REPOSITORY.git
git remote -v
```

Se `origin` esiste già, non aggiungerlo di nuovo.

## 5. Controllare segreti e dati personali

```powershell
rg -n --hidden -g '!node_modules/**' -g '!.env' -g '!data/**' -g '!logs/**' "CRED_KEY=|PASSWORD=|password|token|secret|BEGIN .* PRIVATE KEY" .
```

Rivedi ogni risultato. Le credenziali reali non devono essere committate.

## 6. Preparare il commit

```powershell
git add -A
git status --short
git diff --cached --name-status
git diff --cached -- .env .env.local data logs
```

L'ultimo comando non deve mostrare file personali. Se un file è stato aggiunto per errore:

```powershell
git restore --staged -- .env .env.local
```

## 7. Salvare il primo commit

```powershell
git commit -m "Prepara UniDesk NA per deploy e uso mobile"
git branch -M main
git push -u origin main
```

Usa Git Credential Manager o il browser per autenticarti. Non mettere token personali nella URL del comando.

## 8. Salvare gli aggiornamenti successivi

```powershell
git pull --rebase origin main
git status --short
git add -A
git diff --cached --name-status
git commit -m "Descrivi brevemente la modifica"
git push origin main
```

## 9. Verificare il commit pubblicato

```powershell
git log -1 --oneline
git status --short
git ls-remote origin refs/heads/main
```

La cartella deve risultare pulita e il commit remoto deve corrispondere a quello locale.

## 10. Regole da non dimenticare

- Non eseguire `git add .env`, `git add data`, `git add logs` o `git add *.sqlite`.
- Non committare password, cookie, token, chiavi private, backup o screenshot personali.
- Non usare `git push --force` sul branch principale senza una procedura di recupero.
- Prima di ogni deploy ripetere `npm run check`, `npm run smoke:health`, `npm run lint` e `npm run build`.
