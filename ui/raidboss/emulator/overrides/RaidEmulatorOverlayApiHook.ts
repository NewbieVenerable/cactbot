import { setOverlayHandlerOverride } from '../../../../resources/overlay_plugin_api';
import { OverlayHandlerAll, OverlayHandlerResponses, OverlayHandlerResponseTypes, PluginCombatantState } from '../../../../types/event';
import AnalyzedEncounter from '../data/AnalyzedEncounter';
import LineEvent, { isLineEventSource } from '../data/network_log_converter/LineEvent';
import { LineEvent0x03 } from '../data/network_log_converter/LineEvent0x03';
import RaidEmulator from '../data/RaidEmulator';

export default class RaidEmulatorOverlayApiHook {
  currentLogTime: number;
  connected: boolean;
  constructor(private emulator: RaidEmulator) {
    setOverlayHandlerOverride('getCombatants', this._getCombatantsOverride.bind(this));
    this.currentLogTime = 0;
    this.connected = false;

    emulator.on('tick', (currentLogTime: number) => {
      this.currentLogTime = currentLogTime;
    });
    emulator.on('preSeek', () => {
      this.currentLogTime = 0;
    });
    emulator.on('preCurrentEncounterChanged', (encounter: AnalyzedEncounter) => {
      this.currentLogTime = 0;
      encounter.on('analyzeLine', (log: LineEvent) => {
        this.currentLogTime = log.timestamp;
      });
    });
  }

  _getCombatantsOverride(msg: Parameters<OverlayHandlerAll['getCombatants']>[0]):
      OverlayHandlerResponses['getCombatants'] {
    const curEncounter = this.emulator.currentEncounter;
    const tracker = curEncounter?.encounter.combatantTracker;
    if (!tracker || !curEncounter) {
      return new Promise<OverlayHandlerResponseTypes['getCombatants']>((res) => {
        res({
          combatants: [],
        });
      });
    }
    const timestamp = this.currentLogTime;

    const combatants: PluginCombatantState[] = [];
    const ids = msg.ids ?? [];
    const names = msg.names ?? [];
    const hasIds = ids.length > 0;
    const hasNames = names.length > 0;

    for (const [id, combatant] of Object.entries(tracker.combatants)) {
      const numId = parseInt(id, 16);

      // nextSignificantState is a bit inefficient but given that this isn't run every tick
      // we can afford to be a bit inefficient for readability's sake
      const combatantState = {
        ID: numId,
        Name: combatant.name,
        Level: combatant.level,
        Job: combatant.jobId,
        ...combatant.nextSignificantState(timestamp).toPluginState(),
      };
      if (!hasIds && !hasNames)
        combatants.push(combatantState);
      else if (hasIds && ids.includes(numId))
        combatants.push(combatantState);
      else if (hasNames && names.includes(tracker.combatants[id]?.name ?? ''))
        combatants.push(combatantState);
    }
    // @TODO: Move this to track properly on the Combatant object
    combatants.forEach((c) => {
      const lines = curEncounter.encounter.logLines
        .filter((l) => isLineEventSource(l) && l.decEvent === 3 && parseInt(l.id, 16) === c.ID);
      if (lines.length > 0) {
        const line = lines[0] as LineEvent0x03;
        c.OwnerID = parseInt(line.ownerId);
        c.BNpcNameID = parseInt(line.npcNameId);
        c.BNpcID = parseInt(line.npcBaseId);
      }
    });
    return new Promise((res) => {
      res({
        combatants: combatants,
      });
    });
  }
}
