// state/passwords.js — daily-пароли. Объект мутируется по полям
// (today/yesterday переприсваиваются), сам binding не переприсваивается.
export const dailyPasswords = {
  today:{
    value: '',
    date: ''
  },
  yesterday: {
    value: '',
    date: ''
  }
};
