import { readStoredMode } from '../../helpers/theme';

export const initialState = {
  mode: readStoredMode(), // light | dark | system
};

export function reducer(state, action) {
  switch (action.type) {
    case 'set':
      return { ...state, mode: action.payload };
    default:
      return state;
  }
}
