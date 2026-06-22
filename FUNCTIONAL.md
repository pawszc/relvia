# relvia — dokumentacja funkcjonalna

Ten dokument opisuje **jak aplikacja się zachowuje** — co dzieje się po każdej wiadomości, dlaczego
doradca raz mówi, a raz milczy, jak dostosowuje ton, jak chroni parę w kryzysie. Jest pisany
**funkcjonalnie i po ludzku**: dla osoby produktowej, nowej w zespole, testera albo kogoś, kto chce
zrozumieć działanie bez czytania kodu.

Pozostałe dokumenty (uzupełniające):
- **[ENGINE.md](ENGINE.md)** — ten sam silnik od strony technicznej (typy decyzji, reguły, mapa kodu).
- **[CONTRACT.md](CONTRACT.md)** — protokół API (encje, akcje, zdarzenia SSE).
- **[SAFETY.md](SAFETY.md)** — szczegółowa postawa bezpieczeństwa.
- **[README.md](README.md)** — architektura i uruchomienie.

> **Czym to NIE jest.** relvia to **empatyczny mediator**, nie terapeuta, nie usługa kryzysowa
> i nie wyrób medyczny. W realnym zagrożeniu kieruje do profesjonalistów i służb — i mówi to wprost.

---

## 1. W skrócie — czym jest relvia

relvia to czat, w którym **para rozmawia z empatycznym doradcą relacji z jednego urządzenia**.
Dwie osoby — domyślnie „Ona" i „On" (można ustawić własne imiona) — piszą naprzemiennie, podając przy
każdej wiadomości, **kto pisze**: ona, on, albo „razem". Trzecim głosem jest **Doradca** (AI).

Najważniejsza różnica względem zwykłego chatbota: **Doradca nie odpowiada po każdej wiadomości.** Zwykły
asystent zareagowałby na każdą wypowiedź — w rozmowie pary to nienaturalne i stronnicze (AI
„terapeutyzuje" pierwszą osobę, zanim druga w ogóle się odezwie). Tutaj doradca zachowuje się jak
**reżyser rozmowy**: prowadzi ją, ale w tle, i odzywa się tylko wtedy, gdy to realnie pomaga.

**Założenie sprzętowe (ważne dla całego projektu):** jedno urządzenie, podawane **z rąk do ręki**. Tura
jest fizyczna — „oddanie głosu" drugiej osobie to po prostu przekazanie telefonu. Nie ma zdalnej,
asynchronicznej rozmowy ani pingowania nieobecnych.

---

## 2. Zasada naczelna — doradca jako reżyser

> **Doradca ZAWSZE analizuje każdą turę, ale NIE zawsze się odzywa.**

Po każdej wiadomości pary dzieje się **najpierw cicha decyzja** („czy i jak mam zareagować?"), a dopiero
potem — jeśli decyzja brzmi „odezwij się" — powstaje widoczna odpowiedź. Z tej jednej zasady wynika cały
charakter produktu:

1. **Najpierw zrozum, nie spiesz się.** Doradca najpierw **pogłębia** to, co powiedziała osoba (odbija
   uczucie i zadaje jedno otwarte pytanie), zanim odda głos drugiej stronie. Nie doradza, dopóki nie
   usłyszy i nie zrozumie obojga — to chroni przed sojuszem z tym, kto napisał pierwszy.
2. **Miękkie fazy, twardy cel.** Rozmowa ma naturalne fazy (otwarcie → perspektywy → parafraza → sedno →
   ustalenia), ale **nie są to bramki blokujące**. Jest za to **kotwica tematu** — „gwiazda polarna", do
   której doradca wraca, gdy rozmowa zbacza.
3. **Brak postępu uruchamia nacisk.** Gdy para się zapętla (zaprzeczenia, ogólniki), doradca stopniowo
   popycha do konstruktywnego ruchu i **nazywa pętlę wprost**.
4. **Dygresje się parkuje, nie ucina.** Nowy wątek trafia na listę „do omówienia później" — nic nie
   ginie, a rozmowa wraca do tematu.
5. **Bezpieczeństwo jest nadrzędne.** Sygnał kryzysu/przemocy ma absolutny priorytet ponad wszystkim
   innym — fazami, pętlą, pogłębianiem, tonem.

---

## 3. Kto jest kim (aktorzy i pojęcia)

| Pojęcie | Co znaczy |
|---|---|
| **Ona / On** | Dwie osoby z pary. Domyślne etykiety; można ustawić własne imiona. Przy wysyłaniu wiadomości wybiera się, kto pisze. |
| **Razem** | Wiadomość wspólna („mówimy jednym głosem") — wyróżniona w interfejsie. Doradca docenia, gdy para pisze razem. |
| **Doradca** | Głos AI. Ciepły, empatyczny, **neutralny mediator** — nie staje po niczyjej stronie, nie ocenia, kto ma rację. |
| **Tura** | Jedna wysłana wiadomość pary + ewentualna reakcja doradcy. |
| **Faza** | Miękki etap rozmowy (otwarcie, perspektywy, parafraza, sedno, ustalenia) — wskaźnik, nie blokada. |
| **Kotwica tematu** | Krótkie określenie, „o czym właściwie rozmawiamy" — punkt, do którego doradca wraca. |
| **Dymka** | Pojedyncza wypowiedź doradcy w czacie. Bywa pełna (zwykła) albo mała (moderacja przy eskalacji). |
| **Podpowiedź do pola** | Krótki tekst-placeholder w polu wpisywania, naprowadzający następną osobę („od czego zacząć"). |

---

## 4. Jak wygląda rozmowa od początku do końca

Najlepiej widać to na przykładzie. Poniżej typowy przebieg (uproszczony, treści ilustracyjne):

```
Ona:      Mam dość tego, że ogarnianie całego domu wisi tylko na mnie.
Doradca:  Słyszę, że niesiesz to sama i że to męczy. Co czujesz najmocniej w takim momencie —
          że nie widać Twojego wysiłku, czy coś jeszcze?            ← POGŁĘBIENIE (zostaje przy niej)

Ona:      Że jestem jedyną dorosłą osobą, która o wszystkim pamięta.
Doradca:  Dziękuję, że to nazwałaś. Teraz chciałbym usłyszeć drugą stronę.
          [pole podpowiada Jemu: „co się dzieje, gdy słyszysz tę listę?"]   ← ODDANIE GŁOSU

On:       Robię wszystko, o co prosi, a i tak wieczorem słyszę, że za mało.
Doradca:  Widzę, że się starasz i że to frustrujące, gdy wysiłek nie zostaje
          dostrzeżony. Co Ci wtedy chodzi po głowie?                  ← POGŁĘBIENIE (zostaje przy nim)

On:       Że cokolwiek zrobię, nigdy nie będzie dobrze.
Doradca:  Słyszę dwie potrzeby naraz: ona chce poczuć, że niesiecie dom razem;
          ty — że Twój wysiłek się liczy. To nie są sprzeczne rzeczy.   ← PARAFRAZA OBOJGA

Ona/On:   …
Doradca:  Spróbujmy jednego małego kroku: raz w tygodniu, gdy oboje macie siłę,
          spójrzcie na dom razem i ustalcie, co robicie — żebyście oboje
          byli autorami planu, nie jedno wykonawcą.                    ← PROPOZYCJA
```

Zauważ rytm: **pogłębić → oddać głos → pogłębić → sparafrazować obie strony → dopiero potem proponować.**
Doradca dochodzi do rozwiązań **dopiero wtedy, gdy obie strony czują się zrozumiane**.

---

## 5. Co doradca robi po każdej wiadomości (katalog reakcji)

### 5.1 Zawsze analizuje, nie zawsze mówi

Po każdej wiadomości doradca podejmuje jedną decyzję z poniższej listy. Część z nich oznacza **milczenie**
(daje parze przestrzeń), reszta — **wypowiedź** o konkretnym celu.

### 5.2 Priorytety (co wygrywa, gdy pasuje kilka rzeczy)

```
BEZPIECZEŃSTWO  >  ESKALACJA  >  bezpośrednie pytanie do doradcy  >  pogłębianie / oddanie głosu  >  reszta
```

Dodatkowo jest **twarda reguła**: gdy para zwraca się **wprost do doradcy** albo prosi o zdanie/radę/ocenę
(„doradco…", „co o tym myślisz?", „powiedz szczerze") — doradca **zawsze** się odzywa. Zignorowanie
bezpośredniego pytania to błąd.

### 5.3 Tabela reakcji

| Reakcja | Mówi? | Kiedy się pojawia | Co robi / co widzi użytkownik |
|---|---|---|---|
| **Milczenie** | nie | Para rozmawia między sobą i nie oczekuje teraz głosu; ktoś kontynuuje własną myśl | Doradca nie dodaje dymki; widać dyskretny status obecności (np. „Doradca czeka…") |
| **Pogłębienie** | tak | Wypowiedź niesie uczucie/treść, w której jest jeszcze coś do zrozumienia | Odbija uczucie i zadaje **jedno** otwarte pytanie **do tej samej osoby** |
| **Oddanie głosu** | tak | Pierwsza osoba została wysłuchana, druga jeszcze nie mówiła w tym wątku | Krótko docenia i zaprasza drugą stronę (pole podpowiada właśnie jej) |
| **Doproszenie o konkret** | tak | Padła krótka, ogólna negacja bez treści („nieprawda!") | Prosi o jeden konkretny przykład zamiast oceny całości |
| **Przeramowanie** | tak | Rozmowa krąży wokół tego samego z dwóch stron | Nazywa **wspólną potrzebę** pod sporem i wraca do tematu |
| **Zwężenie** | tak | Utknięcie w ogólnikach | Prosi, by każde podało **jeden** konkretny przykład |
| **Wybór wątku** | tak | Na stole kilka spraw naraz | Proponuje wybrać jedną, najważniejszą; resztę odłożyć |
| **Propozycja kroków** | tak | Rozmowa się zapętla albo obie strony już się rozumieją | Proponuje 1–3 małe, konkretne kroki do wypróbowania |
| **Parafraza obojga** | tak | Obie strony wypowiedziały się „z treścią" | Streszcza uczucia i potrzeby **obu** osób, zanim cokolwiek zaproponuje |
| **Moderacja (interwencja)** | tak | Eskalacja **wzajemna**: obie strony atakują, podnoszą głos, obwiniają się | **Mała, wyróżniona dymka** — łagodzi napięcie, prosi mówić o sobie zamiast oskarżać; nie staje po stronie |
| **Ochrona** | tak | **Wzorzec krzywdy jednej strony** (poniżanie, kontrola, przerzucanie winy, gaslighting), poniżej progu zagrożenia | **Nie mediuje symetrycznie** — potwierdza realność tego, co przeżywa skrzywdzona osoba, łagodnie nazywa wzorzec, staje po stronie jej godności; może wskazać wsparcie indywidualne (patrz §12) |
| **Stop bezpieczeństwa** | tak | Sygnał przemocy, samookaleczenia, myśli samobójczych, zagrożenia życia/zdrowia | **Przerywa mediację**, kieruje do profesjonalnej pomocy/służb z konkretnym numerem (patrz §12) |

### 5.4 Tempo i głębia (pogłębianie adaptacyjne)

Doradca **nie spieszy się** z oddawaniem głosu. Najpierw zostaje przy mówiącej osobie i pogłębia — ale
**tylko dopóki to produktywne**:

- pogłębia, gdy odpowiedź wnosi **nową treść lub emocję**, a sedno wciąż nie zostało nazwane;
- **przestaje** i rusza dalej, gdy osoba wygląda na naprawdę wysłuchaną / nazwała sedno, ALBO jej
  odpowiedź się urywa (krótka, w kółko to samo, „nie wiem"), ALBO pogłębiał już z nią mniej więcej dwa razy.

Liczba pogłębień **nie jest sztywna**: dla płytkiego/praktycznego tematu może być zero, dla trudnego
emocjonalnie jedno–dwa. Dobiera ją sytuacja. (Jest tylko bezpiecznik: gdyby doradca wpadł w pętlę pytań,
po trzech pogłębieniach z rzędu i tak ruszy dalej.)

### 5.5 Gdy nie ma postępu — stopniowany nacisk

Jeśli para utyka (zaprzeczenia, ogólniki, urywki), doradca **stopniowo zwiększa nacisk** w stronę
konkretu, zamiast w nieskończoność dopytywać tym samym tonem:

```
doproszenie o konkret → przeramowanie → zwężenie do przykładu → wybór jednego wątku → propozycja kroków
```

Po drodze **nazywa pętlę wprost** („krążymy wokół tego samego") — to też jest forma pomocy.

---

## 6. Rejestr empatii — dostosowanie do odbiorcy (wg płci)

To jeden z wyróżników produktu i wymaga osobnego, dokładnego opisu.

### 6.1 Zasada: to samo ciepło, inna droga

Doradca daje **pełne, równe ciepło obojgu**. Różni się **droga dojścia do emocji**, nie jej natężenie.
Obserwacja, na której to stoi: część osób (statystycznie częściej mężczyźni) łatwiej dochodzi do uczucia
**przez konkret i zdarzenie** niż przez polecenie „nazwij, co czujesz". Pytanie „co czujesz?" bywa wtedy
jak egzamin, który się oblewa; „co się stało?" / „co zrobiłeś?" otwiera tę samą emocję innymi drzwiami.

Dwie ważne gwarancje:
- **Płeć to miękki prior, nie sztywna reguła.** Jeśli osoba realnie pisze o sobie emocjonalnie, doradca
  idzie za jej stylem, nie za etykietą.
- **Bezpieczeństwo i łagodzenie eskalacji są symetryczne** — patrz §6.5.

### 6.2 Trzy rejestry — wg tego, do kogo skierowana jest wypowiedź

| Adresat | Rejestr |
|---|---|
| **Do niej** | Obecny, sprawdzony ton: nazwij uczucie wprost, odbij je z empatią, zaproś do głębszego nazwania potrzeby. |
| **Do niego** | Pełne ciepło, ale wejście w emocje **przez zdarzenie/działanie** (nie „co czujesz"); **walidacja wysiłku, intencji, odpowiedzialności** (nie tylko kruchości); **bez tonu pouczającego** (żadnych pytań-wyzwań „czy potrafisz…", „co stoi na przeszkodzie, żebyś…"); bezpośrednio, jak do partnera, nie jak instruktaż. |
| **Do obojga** | Ton neutralny, **most-tłumacz** między dwoma „dialektami" tej samej potrzeby: pokazuje, że potrzeba bliskości i odruch „rozwiążmy to" są dwoma sposobami na to samo — żeby każde usłyszało troskę drugiego w swoim języku. |

Adresat wynika z sytuacji: pogłębienie idzie do osoby, która właśnie mówiła; oddanie głosu — do drugiej
strony; parafraza, przeramowanie i propozycje — do obojga.

### 6.3 Drzwi wejścia w podpowiedzi do pola

Ta sama logika dotyka **podpowiedzi wpisywanej w pole tekstowe** dla następnej osoby. Domyślnie:
mężczyzna → wejście „przez zdarzenie" („co się stało, gdy…", „co Ci chodziło po głowie?"), kobieta →
wejście „przez uczucie" jest w porządku. Styl osoby może to nadpisać.

Na **samym początku** rozmowy z mężczyzną (gdy jeszcze nie zdążył pokazać swojego stylu) działa
dodatkowy, deterministyczny strażnik: jeśli podpowiedź dla niego brzmiałaby „co czujesz…", zostaje
zamieniona na wejście przez zdarzenie. Po kilku jego turach strażnik się wyłącza i prowadzi sam model.

### 6.4 Co to znaczy dla użytkownika (przykład)

Ten sam żal, raz adresowany do niego, raz do niej:

```
Do NIEGO:  „Widzę, że się starasz i że to frustrujące, gdy wysiłek nie zostaje dostrzeżony.
            Co Ci chodziło po głowie, gdy to usłyszałeś?"
Do NIEJ:   „Słyszę, że czujesz się niedoceniona i że to bolesne.
            Co czujesz najmocniej w takim momencie?"
```

Oba prowadzą do tej samej emocji — drugie po prostu nie każe zaczynać od nazwania jej „na zimno".

### 6.5 Granica: rejestr nigdy nie dotyka bezpieczeństwa

Przy **stopie bezpieczeństwa**, **moderacji eskalacji** i **ochronie** (asymetria ofiara/sprawca, §12) dostrajanie tonu wg płci jest **wyłączone**.
Dymka kryzysowa i łagodzenie kłótni są **identyczne niezależnie od płci** adresata, a wykrywanie
przemocy jest symetryczne (przemoc „ze strony partnera" w obie strony). Profil empatii to wyłącznie
sprawa zwykłej mediacji.

---

## 7. Inteligentne pole wpisywania (kompozytor)

Pole, w które para pisze, **odzwierciedla kierunek rozmowy** — zawsze jednak pozostając w pełni
nadpisywalne (nigdy nie nadpisuje tego, co użytkownik już zaczął pisać):

- **Automatyczny autor** — po „oddaniu głosu" pole przełącza się na drugą osobę; po pogłębieniu zostaje
  przy tej samej. (Zmiana następuje **tylko gdy pole jest puste**.)
- **Podpowiedź (placeholder)** — krótki tekst naprowadzający, generowany w kontekście rozmowy i
  **różnicowany z tury na turę** (nie powtarza tej samej). To właśnie tu działają „drzwi wejścia" z §6.3.
- **Po dłuższej ciszy** pole przełącza się na autora „Razem" z zapraszającym placeholderem.

Gdy model nie poda podpowiedzi (albo działa tryb offline), pojawia się sensowna podpowiedź zastępcza wg
typu ostatniej reakcji.

---

## 8. Tryby doradcy — „Rozmawia" i „Tylko słucha"

W nagłówku jest trwały, dwustanowy przełącznik.

**„Rozmawia"** (domyślnie) — reżyser działa jak w całym tym dokumencie: po każdej turze decyduje, czy
mówić, czy świadomie się wycofać w milczenie.

**„Tylko słucha"** — doradca jest **całkowicie wyłączony**. To prywatna przestrzeń pary „między sobą":
- wiadomości **tylko się zapisują**, doradca nie analizuje i nie odpowiada;
- **żadnych wywołań modelu** — zero kosztu;
- w tym trybie **nie ma także wykrywania kryzysu** (bo model w ogóle nie jest wołany) — to świadomy
  kompromis, opisany w §12 i §16;
- wejście w ten tryb zostawia **ciepłe pożegnanie** doradcy (gotowy tekst, zero kosztu);
- **powrót następuje tylko przełącznikiem** z powrotem na „Rozmawia". Po powrocie doradca dostaje pełną
  historię — także to, co padło w trybie cichym — i nadrabia kontekst.

**Cisza / bezczynność.** Gdy przez dłuższy czas (ok. 2 minut) nikt nie pisze, interfejs delikatnie
zaprasza do powrotu: pole wpisywania przełącza autora na **„Razem"** i pokazuje zachęcającą podpowiedź
(„Wróćcie, gdy będziecie gotowi — napiszcie razem, jak poszło…"). To czysto interfejsowy efekt —
**zero kosztu**, żadnego wywołania modelu. W trybie „Tylko słucha" nie działa.

---

## 9. Imiona i sposób zwracania się

- **Bez własnych imion (domyślne Ona/On).** Doradca zwraca się **bezpośrednio**: do piszącej osoby na
  „Ty", do obojga na „Wy"; gdy musi odróżnić — opisowo („Twój partner", „Twoja partnerka", „osoba, która
  właśnie napisała"). **Nie używa słów „Ona"/„On" jak imienia** i nigdy nie powtarza wewnętrznych
  etykiet w odpowiedzi.
- **Z własnymi imionami.** Doradca może zwracać się do pary po imieniu.

Niezależnie od tego, odpowiedzi doradcy są **czyszczone** z technicznych artefaktów (znaczników
formatowania, wiodących etykiet typu „[On]:") — para widzi zawsze zwykły, ciepły tekst.

---

## 10. Obecność doradcy — statusy i wskaźniki

Zamiast „kręciołka ładowania" interfejs pokazuje **obecność reżysera**:

| Tekst w UI | Kiedy |
|---|---|
| **„Doradca słucha…"** | analizuje właśnie zakończoną turę |
| **„Doradca pisze…"** | generuje odpowiedź (na żywo, słowo po słowie) |
| **„Doradca czeka na odpowiedź: {imię}"** / **„…na Waszą wspólną odpowiedź…"** | oddał głos i czeka na konkretną stronę |
| **„Doradca czeka…"** | świadomie milczy (w trybie regułowym/offline bywa „Doradca słucha w milczeniu…") |

Przy **dłuższej ciszy** status sceniczny się chowa — zamiast niego zmienia się podpowiedź w polu (patrz §8).
Dodatkowo widać **wskaźnik fazy** (Otwarcie → Perspektywa I/II → Parafraza → Sedno → Ustalenia) jako miękką
informację o etapie oraz **panel parkingu** (poniżej).

---

## 11. Parkowanie dygresji — „do omówienia później"

Gdy ktoś otwiera **nowy wątek obok bieżącego tematu**, doradca **nie ucina go** — odkłada na bok:
potwierdza krótko („zapiszę to na później") i wraca do kotwicy tematu. Odłożony wątek trafia na widoczną
listę „do omówienia później". Z tej listy można:

- **wróćmy teraz** — ustawia ten wątek jako bieżący temat,
- **załatwione** — oznacza jako domknięty,
- **odrzuć** — usuwa z listy.

Dzięki temu nic ważnego nie ginie, a rozmowa nie rozłazi się na pięć tematów naraz.

---

## 12. Bezpieczeństwo

**Zasada naczelna:** wykrywanie kryzysu robi **model** — semantycznie i wielojęzycznie — i ma **absolutny
priorytet** ponad wszystkim innym.

**Co wykrywa:** przemoc (też domową, ze strony partnera, wobec dzieci), samookaleczenie, myśli
samobójcze, zagrożenie życia/zdrowia — **w dowolnym języku**, także parafrazą, eufemizmem czy aluzją
(„nie chcę dłużej żyć", „lepiej żeby mnie nie było", „boję się, że mnie skrzywdzi"). Jednocześnie
**odróżnia przenośnię** od realnego sygnału („zabija mnie ta cisza", „umieram z tęsknoty") — sama
metafora nie jest alarmem, co chroni przed fałszywymi alarmami.

**Co wtedy robi (stop bezpieczeństwa):**
- **przerywa mediację** — nie analizuje konfliktu, nie rozstrzyga, kto ma rację;
- ciepło, bez paniki i bez oceniania nazywa powagę sytuacji;
- mówi, że teraz najważniejsze jest bezpieczeństwo;
- zachęca do **natychmiastowego kontaktu z profesjonalistą lub służbami, podając konkretny numer**;
- nie udaje terapeuty.

**Tor ochronny (poniżej progu kryzysu).** Osobna kategoria między zwykłą mediacją a stopem bezpieczeństwa:
gdy widać **wzorzec krzywdy jednej strony** wobec drugiej (poniżanie, kontrola/izolacja, przerzucanie całej
winy, gaslighting, szantaż), ale bez bezpośredniego zagrożenia życia. Neutralny mediator tworzyłby tu
**fałszywą symetrię** (równałby krzywdę z odczuciem sprawcy, kazałby ofierze „mówić o sobie zamiast oceniać").
Zamiast tego doradca **nie mediuje symetrycznie**: potwierdza realność tego, co przeżywa skrzywdzona osoba
(„to nie jest w porządku i nie jest Twoją winą"), łagodnie nazywa wzorzec i staje po stronie jej godności;
może wskazać wsparcie indywidualne. Odróżnia to od **wzajemnej** kłótni (gdzie ogień jest po obu stronach —
wtedy moderacja, nie ochrona) — z twardym strażnikiem przed fałszywym alarmem (zwykły konflikt ≠ przemoc).

**Świadome kompromisy** (decyzje produktowe, szerzej w [SAFETY.md](SAFETY.md)):
- W trybie **„Tylko słucha" detekcja jest wyłączona** (model nie jest wołany) — celowo, „to ich prywatna
  przestrzeń".
- **Numer kryzysowy podaje model**, bez doklejanego stałego bloku zasobów (zaakceptowane ryzyko, że
  model poda nieaktualny numer — w zamian: naturalność).
- **Nie ma stałego panelu „pilna pomoc"** — model sam zabezpiecza.

---

## 13. Pamięć i trwałość rozmowy

Stan rozmowy jest **trwały**: faza, kotwica tematu, tryb doradcy, liczniki postępu i eskalacji, lista
zaparkowanych tematów oraz cała historia wiadomości są zapisywane. Po odświeżeniu strony interfejs
**odtwarza** stan i historię — rozmowa wygląda dokładnie tam, gdzie ją zostawiono. Imiona pary również
pochodzą z zapisu, nie z kodu.

---

## 14. Koszt (funkcjonalnie)

Doradca działa na płatnym modelu AI, więc projekt świadomie pilnuje kosztu:

- **Cicha decyzja po każdej turze** kosztuje trochę — odpala się **zawsze**, nawet gdy doradca ostatecznie
  milczy.
- **Generacja wypowiedzi** kosztuje więcej, ale powstaje **tylko gdy doradca mówi**. Tury, w których
  milczy, są tańsze.
- **Tryb „Tylko słucha" jest darmowy** — zero wywołań modelu.
- W długiej rozmowie koszt rośnie szybciej niż liniowo, bo każda decyzja bierze pod uwagę całą dotychczasową
  historię (to znany kandydat do optymalizacji).

Aplikacja **rozlicza zużycie** i pokazuje koszt z podziałem na „decyzje" vs „wypowiedzi", przeliczony na
dolary wg stawek aktywnego modelu.

---

## 15. Wielojęzyczność

Rozumienie i odpowiadanie zapewnia **model**, który jest wielojęzyczny — łącznie z wykrywaniem kryzysu i
eskalacji w dowolnym języku. Proste reguły „awaryjne" w kodzie (patrz §16) są **tylko po polsku** i służą
jako siatka na wypadek awarii modelu; poza polskim po prostu milczą, a całość niesie model. Jeden mały,
polski strażnik działa też na żywo (drzwi wejścia z §6.3) — poza polskim jest niewidoczny i nieszkodliwy.

---

## 16. Świadome granice i kompromisy

- **To nie jest usługa kryzysowa ani terapia.** Doradca to mediator i mówi to wprost; w zagrożeniu kieruje
  do profesjonalistów.
- **„Tylko słucha" = brak detekcji bezpieczeństwa** (świadomy wybór — prywatność pary).
- **Numery kryzysowe pochodzą od modelu** (ryzyko nieaktualności w zamian za naturalność).
- **Reguły awaryjne są po polsku.** W normalnym działaniu śpią — budzą się tylko, gdy model zawiedzie
  (zły wynik / przekroczony czas / brak odpowiedzi), żeby aplikacja nigdy „nie zamilkła" i wciąż złapała
  najbardziej oczywiste sygnały. W innym języku ta siatka łapie niewiele — od wielojęzyczności jest model.
- **Jedno urządzenie, z rąk do rąk** — brak zdalnej, asynchronicznej rozmowy.
- **Znane do dopracowania:** ton wypowiedzi do mężczyzny bywa miejscami zbyt „pouczający" mimo zabezpieczeń
  (wariancja modelu); zdarzają się drobne literówki/wtręty obcych znaków przy słabszym modelu.

---

## 17. Słowniczek

| Termin | Znaczenie |
|---|---|
| **Reżyser** | Sposób działania doradcy: zawsze analizuje turę, nie zawsze mówi. |
| **Tura** | Jedna wiadomość pary + ewentualna reakcja doradcy. |
| **Pogłębienie** | Odbicie uczucia + jedno otwarte pytanie do tej samej osoby, zanim odda głos drugiej. |
| **Oddanie głosu** | Zaproszenie drugiej strony do wypowiedzi, gdy pierwsza została wysłuchana. |
| **Parafraza obojga** | Streszczenie uczuć i potrzeb **obu** osób przed jakąkolwiek propozycją. |
| **Moderacja / interwencja** | Krótka, łagodząca dymka przy eskalacji; nie staje po niczyjej stronie. |
| **Stop bezpieczeństwa** | Przerwanie mediacji i skierowanie do pomocy przy sygnale kryzysu. |
| **Kotwica tematu** | „O czym właściwie rozmawiamy" — punkt, do którego doradca wraca. |
| **Faza** | Miękki etap rozmowy (informacyjny, nie blokuje inputu). |
| **Rejestr empatii** | Dostrojenie *drogi dojścia do emocji* wg adresata (to samo ciepło, inne wejście). |
| **Drzwi wejścia** | Sposób, w jaki podpowiedź zaprasza do wypowiedzi — przez uczucie albo przez zdarzenie. |
| **Parking** | Lista „do omówienia później" dla odłożonych dygresji. |
| **Tylko słucha** | Tryb, w którym doradca jest całkowicie wyłączony (prywatna przestrzeń pary, zero kosztu). |

---

## Dodatek: mapa na dokumentację techniczną

| Funkcja z tego dokumentu | Gdzie szukać szczegółów |
|---|---|
| Typy reakcji, reguły, tempo, fazy | [ENGINE.md](ENGINE.md) §3–§5 |
| Rejestr empatii wg płci, drzwi podpowiedzi | [ENGINE.md](ENGINE.md) §3 („Rejestr empatii wg adresata") |
| Protokół (akcje, zdarzenia, encje) | [CONTRACT.md](CONTRACT.md) |
| Bezpieczeństwo (warstwy, kompromisy) | [SAFETY.md](SAFETY.md) |
| Architektura, uruchomienie, koszty | [README.md](README.md) |
