import React from 'react'
import { StyleSheet, Text } from 'react-native'

import ModalDatePicker from 'react-native-datepicker-modal'

import colors from './config/colors'
import spacing from './config/spacing'
import fontSize from './config/fontSize'

const DatePicker = ({ style, ...props }) => (
  <ModalDatePicker
    style={[styles.container, style]}
    renderDate={({ year, month, day, date }) => {
      if (!date) {
        return <Text style={[styles.text, styles.placeholderText]}>Date of birth</Text>
      }

      const dateStr = `${day}-${month}-${year}`
      return <Text style={styles.text}>{dateStr}</Text>
    }}
    {...props}
  />
)

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.white,
    borderBottomColor: colors.gray.veryLight,
    borderBottomWidth: 1,
    marginVertical: spacing[1],
    marginHorizontal: spacing[0],
    justifyContent: 'center',
    borderRadius: 2,
    height: 50
  },
  placeholderText: {
    color: colors.gray.light
  },
  text: {
    width: '100%',
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[0],
    fontFamily: 'Montserrat',
    fontSize: fontSize.medium,
    color: colors.gray.dark
  }
})

export default DatePicker
