# RunLoop -- SessionProfile, scoring och referenspass

**För:** Wictor\
**Syfte:** Förtydliga vad vi konkret försöker bygga först, hur
scoring-idén passar in och vad Kevins manuella "facit" är till för.

## Kortversionen

Vi pratar i princip om samma sak med idén om att "scorea" varje pass.
Skillnaden är att vi inte bör börja med ett enda bra/dåligt-score.

Först vill vi omvandla varje rått Garmin/Suunto-pass till en
strukturerad, flerdimensionell `SessionProfile`.

``` text
Garmin/Suunto-data
        ↓
SessionProfile
        ↓
WeekProfile
        ↓
TrainingBlock
        ↓
Athlete Model
        ↓
Framtida träningsbeslut
```

Kevins manuella facit på 20--30 gamla pass är **inte en del av produkten
eller onboarding**. Det är bara vårt utvecklings- och valideringsset för
att kontrollera att algoritmen faktiskt förstår träningsdatan.

En framtida användare ska alltså inte behöva klassificera eller
betygsätta sina gamla pass.

------------------------------------------------------------------------

# 1. Första problemet: vad hände faktiskt i passet?

Vi har redan `Activity`, `ActivityLap[]` och `ActivityStream`, med bland
annat puls, fart, duration, distans, elevation, cadence och ibland
temperatur.

Första analysmotorn ska få ett historiskt pass **utan att vi berättar
vad passet var** och försöka rekonstruera det.

Exempel:

``` text
15 min uppvärmning
6 × ~5 min snabbare löpning
~60 s lugn löpning mellan
15 min nedjogg
```

Första lagret borde kunna upptäcka ungefär:

``` text
Intervallstruktur hittad
6 arbetssegment
~5:00 per arbetssegment
~1:00 recovery
relativt jämn arbetsfart
progressiv puls
ingen tydlig försämring i sista reps
```

Därefter kan klassificeringen försöka säga:

``` text
Trolig typ: threshold intervals
Confidence: high
```

Det är bra att separera:

``` text
VAD HÄNDE?
↓
VAD VERKAR DET VARA FÖR TYP AV PASS?
↓
VILKET STIMULUS VERKAR DET HA GETT?
↓
HUR GENOMFÖRDES DET?
```

## Puls är en signal, inte hela algoritmen

Vi bör inte börja med en regel som `maxpuls X = pass Y`.

Potentiella signaler är exempelvis:

-   laps
-   pace/speed stream
-   HR stream
-   duration och distance
-   work/recovery-mönster
-   pace-förändringar
-   HR progression
-   cadence
-   elevation
-   stopp
-   temperatur
-   historiskt HR-beteende
-   känd max-/threshold-HR när sådan finns
-   activity description

Strukturen kan ofta säga "intervallpass" innan vi ens behöver avgöra om
intervallerna var threshold, VO2, 10K-specific osv.

------------------------------------------------------------------------

# 2. Scoring-idén är rätt -- men behåll dimensionerna

Det är rimligt att algoritmiskt utvärdera varje pass. Men hellre:

``` text
Classification: Threshold intervals
Classification confidence: HIGH
Execution consistency: HIGH
Threshold stimulus: HIGH
Aerobic stimulus: MODERATE
Mechanical cost: MODERATE
Recovery cost: UNKNOWN
Data quality: HIGH
```

än:

``` text
Workout score: 87/100
```

Problemet med `87/100` är: **87 på vad?**

Ett recovery-pass kan vara perfekt genomfört trots låg
VO2/threshold-stimulus. Ett brutalt intervallpass kan ge stor stimulus
men vara ett dåligt beslut vid fel tidpunkt.

Håll därför åtminstone isär:

-   `classification` -- vad var det för pass?
-   `structure` -- hur såg det faktiskt ut?
-   `execution` -- hur genomfördes det?
-   `stimulus` -- vilken typ av belastning/adaptation verkar det rikta
    sig mot?
-   `cost` -- hur krävande verkar det ha varit?
-   `dataQuality` -- hur bra är datan?
-   `confidence` -- hur säkra är vi?
-   `uncertainty` -- vad kan vi inte avgöra?

Vi kan alltid skapa enklare scores senare utan att ha kastat bort
grundinformationen.

------------------------------------------------------------------------

# 3. Kevins "facit" är bara ett test-set

Kevin väljer ungefär 20--30 historiska pass som han minns bra, med
variation: easy, recovery, long, progression, threshold, intervaller,
race, benchmark, dåligt/avbrutet pass, dålig HR-data och några
svårtolkade pass.

För varje pass skriver Kevin ett privat facit, exempelvis:

``` text
Datum: 2025-02-12
Faktiskt pass: 6 × 5 min threshold, ~60 s recovery
Avsikt: kontrollerat threshold-pass
Bedömning: genomfört enligt plan, jämnt
RPE: cirka 6/10
Kontext: löpband
```

**Algoritmen får inte se facit.**

Den får bara RunLoop/Garmin-datan. Sedan jämför vi dess `SessionProfile`
mot facit:

``` text
Rätt bred passkategori?          JA / DELVIS / NEJ
Rätt antal arbetssegment?        JA / DELVIS / NEJ
Rätt work/recovery-struktur?     JA / DELVIS / NEJ
Rimlig intensitetstolkning?      JA / DELVIS / NEJ
Rimlig execution-bedömning?      JA / DELVIS / NEJ
Påstående utan stöd?             JA / NEJ
Missade viktig egenskap?         JA / NEJ
Rimlig confidence?               JA / NEJ
```

Om algoritmen kallar ett vanligt distanspass VO2 har vi hittat ett fel.

Om ett genuint svårtolkat pass blir `UNKNOWN / LOW CONFIDENCE` kan det
vara ett bra resultat. Korrekt osäkerhet är bättre än självsäkert
bullshit.

## Framtida användare gör aldrig detta

Facit finns bara för utveckling:

``` text
Kevin klassificerar kända pass
↓
Algoritmen analyserar samma pass blindt
↓
Vi jämför
↓
Vi hittar fel
↓
Wictor förbättrar features/regler
↓
Vi kör hela test-setet igen
```

När det fungerar ska `SessionProfile(activity)` kunna köras automatiskt
på vilken användares importerade historik som helst.

------------------------------------------------------------------------

# 4. Första implementationen bör vara liten

Bygg inte Athlete Model, limiter detection eller träningsplanering ännu.

## Input

``` text
Activity
+
ActivityLap[]
+
ActivityStream
```

## Output

``` text
SessionProfile
```

För `v0.1` räcker kanske breda typer:

``` text
easy/recovery
long
threshold/tempo
interval
race/benchmark
mixed
unknown
```

Plus:

``` text
detected structure
execution characteristics
stimulus estimate
cost estimate där evidens finns
data quality
confidence
evidence
uncertainty
```

Vi behöver inte känna igen alla tänkbara träningsformer från början.

------------------------------------------------------------------------

# 5. Utvecklingsloopen

Vi behöver inte designa den perfekta fysiologiska algoritmen innan vi
börjar.

``` text
1. Bygg enkel SessionProfile
↓
2. Kör mot gold set
↓
3. Hitta felklassificeringar
↓
4. Undersök varför
↓
5. Lägg till/förbättra feature eller regel
↓
6. Kör hela gold set igen
↓
7. Kontrollera regressions
↓
8. Repetera
```

Behåll gamla testfall så att en fix för ett threshold-pass inte råkar
försämra easy-klassificeringen.

------------------------------------------------------------------------

# 6. När passnivån fungerar: hela historiken

När SessionProfile är trovärdig kör vi den över hela historiken.

Då går vi från:

``` text
hundratals råa aktiviteter
```

till:

``` text
hundratals strukturerade träningsobservationer
```

Sedan:

``` text
SessionProfiles
↓
WeekProfiles
↓
TrainingBlocks
```

En vecka blir då inte bara `72 km`, utan kan beskrivas ungefär:

``` text
72 km / 7 pass
4 easy/recovery
2 threshold
1 long
39 min detekterat threshold-arbete
18 km längsta pass
72 h / 48 h mellan kvalitetspass
Execution: stabil
Datatäckning: hög
```

Nu beskriver vi träningens **innehåll**, inte bara mängden.

------------------------------------------------------------------------

# 7. Sedan börjar individualiseringen

När vi har strukturerade pass kan vi jämföra **liknande med liknande**.

Istället för:

``` text
Genomsnittlig löpfart blev 8 s/km snabbare.
```

kan vi kanske säga:

``` text
Över sex jämförbara kontrollerade threshold-pass
ökade arbetsfarten samtidigt som HR och
late-session deterioration var stabila.
```

Vi kan senare jämföra exempelvis liknande easy runs, threshold-pass,
intervallstrukturer, long runs och benchmark/races.

Möjliga jämförelser:

-   pace vid jämförbar HR
-   HR vid jämförbar pace
-   rep pace/HR
-   rep consistency
-   late deterioration
-   HR drift där relevant
-   RPE där det finns
-   environment/recovery context

Sedan kan vi börja gruppera veckor i träningsblock och fråga:

``` text
Vad tränade atleten faktiskt under de här 6 veckorna?
Vad förändrades under/efter blocket?
Har vi sett samma mönster tidigare?
```

Det är där Athlete Model börjar växa fram.

------------------------------------------------------------------------

# 8. Först därefter kommer planeringen

När vi har:

``` text
Athlete Model
+
Goal Model
+
Current State
+
Limiter
+
Historical Evidence
```

kan vi börja fråga:

> Vad borde just den här atleten göra de kommande 4--6 veckorna?

Det är något helt annat än:

> Vad är ett generellt bra 10K-program?

------------------------------------------------------------------------

# Konkret nästa PR

Nästa PR behöver egentligen bara försöka bevisa **en enda sak**:

> **Kan vi ta ett verkligt historiskt pass från databasen, ge algoritmen
> `Activity + ActivityLap[] + ActivityStream` utan manuella labels, och
> få tillbaka en vettig, evidensbaserad `SessionProfile` som beskriver
> vad passet faktiskt innehöll?**

Om ja:

``` text
20–30 gold-set-pass
↓
förbättra tills passnivån är trovärdig
↓
hela historiken
↓
WeekProfile
↓
TrainingBlock
↓
comparable-session analysis
↓
individuell respons
↓
Athlete Model
↓
planning
```

------------------------------------------------------------------------

# Arbetsfördelningen Kevin ↔ Wictor

Kevin behöver inte översätta hela sitt träningskunnande till färdiga
algoritmer.

Wictor behöver inte redan veta exakt vilka fysiologiska metrics som är
rätt.

Gold-set-processen blir bron mellan kompetenserna.

Wictor bygger ett reproducerbart system som försöker tolka datan.

Kevin kan granska output och säga:

``` text
Ja, det här beskriver passet korrekt.
Nej, det här är fysiologiskt missvisande.
Den slutsatsen stöds inte av datan.
Här saknas en viktig del av passet.
Det här borde vara low confidence.
```

Återkommande problem formaliseras sedan gradvis till features, regler
och tester.

**Bygg → testa mot verkliga kända pass → hitta fel → förbättra → testa
igen.**

Det är sannolikt den snabbaste vägen från datan RunLoop redan har till
en analysmotor som faktiskt förstår en idrottares träning.
