# Local onboarding demo

Open [the running demo](http://127.0.0.1:8765) on this computer. The browser walkthrough uses the TypeScript onboarding API and PostgreSQL to save and restore the Break Blueprint and first break.

Open **Dashboard** and choose **Load Alex and Sam** to compare a Stillness profile with a Movement profile. The **Same check-in** controls apply one time limit and feeling to both profiles, and the **Best Fit** row shows each result. The dashboard reads both profiles and their recent break history from PostgreSQL. **Refresh from backend** fetches both again.

Tap Brain Buddy to wave. Brain Buddy cheers when the backend confirms a Blueprint save. With Reduce Motion enabled, both actions show a still response instead.

To build profiles live:

1. Pick **Sample adult** or **Sample teen**. Enter a fictional name and choose a sample email or phone number.
2. Choose a goal, adjust the NOW and GOAL scores, and set a break style, activities, and preferred length. Set a weekly rhythm and review the daily counts and reminder windows before saving.
3. Select **Try my first break**. Enter how you feel, how much time you have, and what you can do where you are. Review Best Fit and its reason, then start it or choose another activity. Let the timer finish or tap **End and check out**. Finish the break as a guest.
4. Select **Save Blueprint + first break**. The saved screen reads back revision 1 and one break. **Retry original save** keeps the revision and break count the same.
5. Use **Start a new break** and try a different check-in. The selection uses the saved Blueprint and the new check-in. Use **Edit my Blueprint** to adjust preferences or the weekly plan. Choose **Add another profile** to try a different set of preferences and compare histories. The browser remembers the demo sessions, so profiles created in another browser have their own switcher.
6. Choose **Sample child (under 13)** from the start screen to show the eligibility stop.

The demo service is bound locally and can be shared through the temporary HTTPS tunnel when it is running. It uses fictional age profiles and contact presets, a separate sample account for each walkthrough, and a dedicated local database. The browser shows the reminder plan. Notification delivery, Apple age assurance, and live sign-in belong to the iPhone and staging builds.

The browser onboarding follows the capstone [Figma wireframes](https://www.figma.com/design/ryOD2O4yHfsgM3MslCq3CO/FUN-da-Mental-s-Onboarding-Wireframes?node-id=0-1) and [FUN·da·Mental Brand Ethos](https://docs.google.com/document/d/1_PCAshbS_n6hAiPC2HLkLT1jEzZ4H2JE/edit#heading=h.csw0fmjs8i). After the sample age check and profile, choose the guided introduction with six Break Check cards, or go straight to the Blueprint. Quiz answers stay in the browser; only the completion flag syncs.

To reopen after a restart, run `powershell -ExecutionPolicy Bypass -File .\Start-Demo.ps1` from this folder with Docker Desktop running. The launcher opens your browser once the API is ready. To stop the services, run `docker compose -f demo/compose.yml down`. Sample database records are retained locally across restarts. The production Dockerfile builds without the local demo feature.
