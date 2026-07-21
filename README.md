# Remontteenus.ee

Üheleheline pisiremondi koduleht, mis on valmis Cloudflare Workersisse paigaldamiseks. Staatiline leht töötab ilma väliste teekideta. Päringuvorm saadab teate Cloudflare Email Service'i kaudu aadressile `inforemontteenus@gmail.com`.

## Kohalik eelvaade

```bash
npm install
npm run dev
```

Ilma Cloudflare'i kontoga ühendamata kuvatakse vormi e-kiri arendusserveri logis, mitte päris postkastis.

## Testid

```bash
npm test
```

## Cloudflare'i paigaldus

1. Cloudflare'is vali **Workers & Pages → Create application → Import a repository**.
2. Vali GitHubi repo `noctaitinfo-ship-it/remontteenus`.
3. Deploy-käsk on `npx wrangler deploy`; build-käsku ei ole vaja.
4. Veendu, et Cloudflare Email Routingus on sihtaadress `inforemontteenus@gmail.com` endiselt **Verified**.
5. Pärast esimest deploy'd lisa Workeri **Custom Domains** alla `remontteenus.ee` ja `www.remontteenus.ee`.

`wrangler.jsonc` piirab vormi e-kirjad ühe kinnitatud sihtaadressi ja saatja aadressiga. Staatilised failid on Cloudflare'is tasuta; ainult vormi `/api/contact` päring käivitab Workeri.

## Enne avaldamist kinnitada

- lubadused: 15+ aastat kogemust, garantii ja vastus tööajal tunni jooksul;
- ettevõtte juriidiline nimi, registrikood ja käibemaksu käsitlus;
- privaatsusteate lõplik tekst;
- päris enne/pärast fotod ja Google'i arvustused saab hiljem lisada, kui need on olemas.

Kuni need punktid on kinnitamata, hoia muudatus eraldi harus või eelvaates ja ära ühenda tootmisharusse.
