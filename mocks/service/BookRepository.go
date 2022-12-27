// Code generated by mockery v2.16.0. DO NOT EDIT.

package mocks

import (
	domain "go-labiblioteca-backend/domain"

	mock "github.com/stretchr/testify/mock"
)

// BookRepository is an autogenerated mock type for the BookRepository type
type BookRepository struct {
	mock.Mock
}

// DeleteBook provides a mock function with given fields: _a0
func (_m *BookRepository) DeleteBook(_a0 string) (int64, error) {
	ret := _m.Called(_a0)

	var r0 int64
	if rf, ok := ret.Get(0).(func(string) int64); ok {
		r0 = rf(_a0)
	} else {
		r0 = ret.Get(0).(int64)
	}

	var r1 error
	if rf, ok := ret.Get(1).(func(string) error); ok {
		r1 = rf(_a0)
	} else {
		r1 = ret.Error(1)
	}

	return r0, r1
}

// GetBooks provides a mock function with given fields:
func (_m *BookRepository) GetBooks() ([]domain.Book, error) {
	ret := _m.Called()

	var r0 []domain.Book
	if rf, ok := ret.Get(0).(func() []domain.Book); ok {
		r0 = rf()
	} else {
		if ret.Get(0) != nil {
			r0 = ret.Get(0).([]domain.Book)
		}
	}

	var r1 error
	if rf, ok := ret.Get(1).(func() error); ok {
		r1 = rf()
	} else {
		r1 = ret.Error(1)
	}

	return r0, r1
}

// InsertBook provides a mock function with given fields: _a0
func (_m *BookRepository) InsertBook(_a0 *domain.Book) (int64, error) {
	ret := _m.Called(_a0)

	var r0 int64
	if rf, ok := ret.Get(0).(func(*domain.Book) int64); ok {
		r0 = rf(_a0)
	} else {
		r0 = ret.Get(0).(int64)
	}

	var r1 error
	if rf, ok := ret.Get(1).(func(*domain.Book) error); ok {
		r1 = rf(_a0)
	} else {
		r1 = ret.Error(1)
	}

	return r0, r1
}

// UpdateBook provides a mock function with given fields: _a0, _a1
func (_m *BookRepository) UpdateBook(_a0 domain.Book, _a1 string) (int64, error) {
	ret := _m.Called(_a0, _a1)

	var r0 int64
	if rf, ok := ret.Get(0).(func(domain.Book, string) int64); ok {
		r0 = rf(_a0, _a1)
	} else {
		r0 = ret.Get(0).(int64)
	}

	var r1 error
	if rf, ok := ret.Get(1).(func(domain.Book, string) error); ok {
		r1 = rf(_a0, _a1)
	} else {
		r1 = ret.Error(1)
	}

	return r0, r1
}

type mockConstructorTestingTNewBookRepository interface {
	mock.TestingT
	Cleanup(func())
}

// NewBookRepository creates a new instance of BookRepository. It also registers a testing interface on the mock and a cleanup function to assert the mocks expectations.
func NewBookRepository(t mockConstructorTestingTNewBookRepository) *BookRepository {
	mock := &BookRepository{}
	mock.Mock.Test(t)

	t.Cleanup(func() { mock.AssertExpectations(t) })

	return mock
}
